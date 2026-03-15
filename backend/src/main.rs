mod auth;
mod db;
mod error;
mod indexer;
mod models;
mod rate_limit;
mod routes;
mod state;
mod webhook_dispatch;

use axum::{
    middleware,
    routing::{delete, get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use auth::require_api_key;
use db::Database;
use routes::{
    apikeys::{create_api_key, delete_api_key, list_api_keys},
    cdp::{get_cdp_position, get_collateral_types, post_cdp_simulate},
    circuit_breaker::set_circuit_breaker,
    compliance::{add_blacklist, get_audit, get_blacklist, remove_blacklist},
    compliance_rules::add_compliance_rule,
    confidential::initiate_confidential_transfer,
    cpi::get_cpi_interface,
    chain_events::chain_events,
    events::events,
    health::health,
    mint::mint,
    burn::burn,
    reserves::get_reserves_proof,
    supply::supply,
    webhooks::{delete_webhook, list_webhooks, register_webhook},
};
use state::AppState;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sss_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Initialize database
    let db_path = std::env::var("DATABASE_URL").unwrap_or_else(|_| "./sss.db".to_string());
    let db = Database::new(&db_path).expect("Failed to initialize database");

    // Bootstrap API key from environment (useful for first-run and testing).
    if let Ok(seed_key) = std::env::var("BOOTSTRAP_API_KEY") {
        if !seed_key.is_empty() {
            match db.validate_api_key(&seed_key) {
                Ok(true) => info!("Bootstrap API key already exists"),
                _ => {
                    // Insert the seed key directly
                    let conn = db.conn.lock().expect("db lock");
                    conn.execute(
                        "INSERT OR IGNORE INTO api_keys (id, key, label, created_at) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![
                            uuid::Uuid::new_v4().to_string(),
                            seed_key,
                            "bootstrap",
                            chrono::Utc::now().to_rfc3339()
                        ],
                    ).expect("Failed to insert bootstrap key");
                    drop(conn);
                    info!("Bootstrap API key seeded");
                }
            }
        }
    }

    // Build shared application state (DB + rate limiter)
    let state = AppState::new(db);

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/mint", post(mint))
        .route("/api/burn", post(burn))
        .route("/api/supply", get(supply))
        .route("/api/events", get(events))
        .route("/api/chain-events", get(chain_events))
        .route("/api/reserves/proof", get(get_reserves_proof))
        .route("/api/compliance/blacklist", get(get_blacklist).post(add_blacklist))
        .route("/api/compliance/blacklist/:id", delete(remove_blacklist))
        .route("/api/compliance/audit", get(get_audit))
        .route("/api/compliance/rule", post(add_compliance_rule))
        .route("/api/cdp/position/:wallet", get(get_cdp_position))
        .route("/api/cdp/collateral-types", get(get_collateral_types))
        .route("/api/cdp/simulate", post(post_cdp_simulate))
        .route("/api/cpi/interface", get(get_cpi_interface))
        .route("/api/confidential/transfer", post(initiate_confidential_transfer))
        .route("/api/webhooks", get(list_webhooks).post(register_webhook))
        .route("/api/webhooks/:id", delete(delete_webhook))
        .route("/api/admin/keys", get(list_api_keys).post(create_api_key))
        .route("/api/admin/keys/:id", delete(delete_api_key))
        .route("/api/admin/circuit-breaker", post(set_circuit_breaker))
        .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state.clone());

    // Determine port
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("SSS Backend listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind address");

    // Spawn the on-chain event indexer (SSS-095).
    // Reads SOLANA_RPC_URL env var (default: devnet).
    indexer::spawn_indexer(state.clone());

    axum::serve(listener, app)
        .await
        .expect("Server error");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use tower::ServiceExt;

    use crate::rate_limit::RateLimiter;

    fn build_app() -> (Router<()>, String) {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        // Pre-create an API key for tests
        let key_entry = db.create_api_key("test").expect("Failed to create test API key");
        let test_key = key_entry.key.clone();

        let state = AppState::new(db);

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let app = Router::new()
            .route("/api/health", get(health))
            .route("/api/mint", post(mint))
            .route("/api/burn", post(burn))
            .route("/api/supply", get(supply))
            .route("/api/events", get(events))
            .route("/api/chain-events", get(chain_events))
            .route("/api/compliance/blacklist", get(get_blacklist).post(add_blacklist))
            .route("/api/compliance/blacklist/:id", delete(remove_blacklist))
            .route("/api/compliance/audit", get(get_audit))
            .route("/api/compliance/rule", post(add_compliance_rule))
            .route("/api/reserves/proof", get(get_reserves_proof))
            .route("/api/cdp/position/:wallet", get(get_cdp_position))
            .route("/api/cdp/collateral-types", get(get_collateral_types))
            .route("/api/cdp/simulate", post(post_cdp_simulate))
            .route("/api/cpi/interface", get(get_cpi_interface))
            .route("/api/confidential/transfer", post(initiate_confidential_transfer))
            .route("/api/webhooks", get(list_webhooks).post(register_webhook))
            .route("/api/webhooks/:id", delete(delete_webhook))
            .route("/api/admin/keys", get(list_api_keys).post(create_api_key))
            .route("/api/admin/keys/:id", delete(delete_api_key))
            .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
            .layer(cors)
            .with_state(state);

        (app, test_key)
    }

    /// Build an app with a tiny rate limiter (capacity = N, no refill) so we
    /// can exercise the 429 path without hammering the default 60-token bucket.
    fn build_app_with_capacity(capacity: u32) -> (Router<()>, String) {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        let key_entry = db.create_api_key("rl-test").expect("Failed to create test API key");
        let test_key = key_entry.key.clone();

        let state = AppState::with_limiter(db, RateLimiter::new(capacity, 0.0));

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let app = Router::new()
            .route("/api/health", get(health))
            .route("/api/supply", get(supply))
            .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
            .layer(cors)
            .with_state(state);

        (app, test_key)
    }

    #[tokio::test]
    async fn test_health_check() {
        // Health is public — no key needed
        let (app, _key) = build_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_auth_rejects_missing_key() {
        let (app, _key) = build_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/supply")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_auth_rejects_bad_key() {
        let (app, _key) = build_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/supply")
                    .header("X-Api-Key", "sss_notarealkey000000000000000000000000000000000000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_mint_event() {
        let (app, key) = build_app();
        let body = serde_json::json!({
            "token_mint": "So11111111111111111111111111111111111111112",
            "amount": 1000000,
            "recipient": "RecipientAddress123456789012345678901234567",
            "tx_signature": "5KtP9x2cZg7DnK1mHMT3fQ8uBpz4Wj6Yx9AvN2rELsS"
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/mint")
                    .header("content-type", "application/json")
                    .header("X-Api-Key", key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_burn_event() {
        let (app, key) = build_app();
        let body = serde_json::json!({
            "token_mint": "So11111111111111111111111111111111111111112",
            "amount": 500000,
            "source": "SourceAddress123456789012345678901234567890",
            "tx_signature": "3Yz8AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AB"
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/burn")
                    .header("content-type", "application/json")
                    .header("X-Api-Key", key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_supply_calculation() {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        let db = std::sync::Arc::new(db);

        // Record some events
        db.record_mint("mint1", 1000, "addr1", None).unwrap();
        db.record_mint("mint1", 500, "addr2", None).unwrap();
        db.record_burn("mint1", 200, "addr1", None).unwrap();

        let (minted, burned) = db.get_supply(Some("mint1")).unwrap();
        assert_eq!(minted, 1500);
        assert_eq!(burned, 200);
        assert_eq!(minted.saturating_sub(burned), 1300);
    }

    #[tokio::test]
    async fn test_blacklist_add_and_check() {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        let db = std::sync::Arc::new(db);

        let address = "BlockedAddress12345678901234567890123456789";
        assert!(!db.is_blacklisted(address).unwrap());

        db.add_blacklist(address, "Test reason").unwrap();
        assert!(db.is_blacklisted(address).unwrap());

        let list = db.get_blacklist().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].address, address);
    }

    #[tokio::test]
    async fn test_webhook_crud() {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        let db = std::sync::Arc::new(db);

        let events = vec!["mint".to_string(), "burn".to_string()];
        let entry = db.register_webhook("https://example.com/webhook", &events).unwrap();

        let list = db.list_webhooks().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].url, "https://example.com/webhook");

        let deleted = db.delete_webhook(&entry.id).unwrap();
        assert!(deleted);

        let list = db.list_webhooks().unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn test_events_endpoint() {
        let (app, key) = build_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/events")
                    .header("X-Api-Key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    // SSS-095: event_log table + GET /api/chain-events
    #[tokio::test]
    async fn test_chain_events_endpoint_empty() {
        let (app, key) = build_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/chain-events")
                    .header("X-Api-Key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["data"].as_array().unwrap().len(), 0, "empty event_log returns empty array");
    }

    #[tokio::test]
    async fn test_chain_events_insert_and_query() {
        let db = Database::new(":memory:").expect("db");
        // Insert two events of different types
        db.insert_event_log(
            "circuit_breaker_toggle",
            "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat",
            serde_json::json!({"halted": true, "authority": "test"}),
            Some("sig1"),
            Some(12345),
        ).unwrap();
        db.insert_event_log(
            "cdp_liquidate",
            "someposition123",
            serde_json::json!({"debt_cleared": 1000, "collateral_seized": 500}),
            Some("sig2"),
            Some(12350),
        ).unwrap();

        let key_entry = db.create_api_key("test").unwrap();
        let test_key = key_entry.key.clone();
        let state = AppState::new(db);
        let app = Router::new()
            .route("/api/chain-events", get(chain_events))
            .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
            .with_state(state);

        // Query all
        let resp = app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/chain-events")
                    .header("X-Api-Key", &test_key)
                    .body(Body::empty())
                    .unwrap(),
            ).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["data"].as_array().unwrap().len(), 2, "should return both events");

        // Query by type
        let resp = app.clone()
            .oneshot(
                Request::builder()
                    .uri("/api/chain-events?type=circuit_breaker_toggle")
                    .header("X-Api-Key", &test_key)
                    .body(Body::empty())
                    .unwrap(),
            ).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let entries = json["data"].as_array().unwrap();
        assert_eq!(entries.len(), 1, "type filter: only circuit_breaker_toggle");
        assert_eq!(entries[0]["event_type"], "circuit_breaker_toggle");
        assert_eq!(entries[0]["slot"], 12345);

        // Query by address
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/chain-events?address=someposition123")
                    .header("X-Api-Key", &test_key)
                    .body(Body::empty())
                    .unwrap(),
            ).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let entries = json["data"].as_array().unwrap();
        assert_eq!(entries.len(), 1, "address filter: only cdp_liquidate");
        assert_eq!(entries[0]["event_type"], "cdp_liquidate");
    }

    #[tokio::test]
    async fn test_blacklist_endpoint() {
        let (app, key) = build_app();
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/compliance/blacklist")
                    .header("X-Api-Key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_api_key_management() {
        let (app, key) = build_app();
        // List keys — should include the bootstrap key
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/admin/keys")
                    .header("X-Api-Key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    /// Verify that requests beyond the bucket capacity are rejected with 429.
    ///
    /// Uses a capacity-3, zero-refill limiter so the test is fast and deterministic.
    #[tokio::test]
    async fn test_rate_limit_exceeded() {
        let capacity: u32 = 3;
        let (app, key) = build_app_with_capacity(capacity);

        // `oneshot` consumes the router, so we need to call it differently.
        // Clone the router via a service wrapper isn't needed here since we
        // build a fresh router per request using the shared state internally.
        // Instead, drive via tower::Service directly.
        use tower::Service;
        let mut svc = app.into_service();

        for i in 0..capacity {
            let req = Request::builder()
                .method(Method::GET)
                .uri("/api/supply")
                .header("X-Api-Key", &key)
                .body(Body::empty())
                .unwrap();
            let resp = svc.call(req).await.unwrap();
            assert_eq!(
                resp.status(),
                StatusCode::OK,
                "Request {} (0-indexed) should succeed",
                i
            );
        }

        // One more — should be rate-limited
        let req = Request::builder()
            .method(Method::GET)
            .uri("/api/supply")
            .header("X-Api-Key", &key)
            .body(Body::empty())
            .unwrap();
        let resp = svc.call(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "Request {} (0-indexed) should be rate-limited",
            capacity
        );
    }

    /// Verify that a 429 response includes a `Retry-After` header with a
    /// positive integer value when the limiter has a non-zero refill rate.
    ///
    /// Uses capacity=1, rps=2.0 so `Retry-After` should be 1 second.
    #[tokio::test]
    async fn test_retry_after_header_present() {
        use tower::Service;

        let db = Database::new(":memory:").expect("in-memory db");
        let key_entry = db.create_api_key("ra-test").expect("api key");
        let test_key = key_entry.key.clone();

        // capacity=1, rps=2.0 → Retry-After = ceil((1-0)/2.0) = 1 sec
        let state = AppState::with_limiter(db, RateLimiter::new(1, 2.0));
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);
        let app = Router::new()
            .route("/api/supply", get(supply))
            .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
            .layer(cors)
            .with_state(state);

        let mut svc = app.into_service();

        // Consume the single token.
        let req = Request::builder()
            .method(Method::GET)
            .uri("/api/supply")
            .header("X-Api-Key", &test_key)
            .body(Body::empty())
            .unwrap();
        let resp = svc.call(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // This one should be rate-limited with Retry-After.
        let req = Request::builder()
            .method(Method::GET)
            .uri("/api/supply")
            .header("X-Api-Key", &test_key)
            .body(Body::empty())
            .unwrap();
        let resp = svc.call(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

        let retry_after = resp
            .headers()
            .get("Retry-After")
            .expect("Retry-After header should be present");
        let val: u64 = retry_after
            .to_str()
            .unwrap()
            .parse()
            .expect("Retry-After should be a non-negative integer");
        assert!(val >= 1, "Retry-After should be at least 1 second");
    }
}

// ─── QA Integration Tests ─────────────────────────────────────────────────────
#[cfg(test)]
mod qa_tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
        routing::post as axum_post,
        Json as AxumJson,
    };
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tower::ServiceExt;
    use serde_json::Value;

    fn build_app() -> (Router<()>, String) {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        let key_entry = db.create_api_key("qa-test").expect("create key");
        let test_key = key_entry.key.clone();
        let state = AppState::new(db);
        let app = Router::new()
            .route("/api/health", get(health))
            .route("/api/mint", post(mint))
            .route("/api/burn", post(burn))
            .route("/api/supply", get(supply))
            .route("/api/events", get(events))
            .route("/api/chain-events", get(chain_events))
            .route("/api/compliance/blacklist", get(get_blacklist).post(add_blacklist))
            .route("/api/compliance/audit", get(get_audit))
            .route("/api/compliance/rule", post(add_compliance_rule))
            .route("/api/reserves/proof", get(get_reserves_proof))
            .route("/api/cdp/position/:wallet", get(get_cdp_position))
            .route("/api/cdp/collateral-types", get(get_collateral_types))
            .route("/api/cdp/simulate", post(post_cdp_simulate))
            .route("/api/cpi/interface", get(get_cpi_interface))
            .route("/api/confidential/transfer", post(initiate_confidential_transfer))
            .route("/api/webhooks", get(list_webhooks).post(register_webhook))
            .route("/api/webhooks/:id", delete(delete_webhook))
            .route("/api/admin/keys", get(list_api_keys).post(create_api_key))
            .route("/api/admin/keys/:id", delete(delete_api_key))
            .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
            .with_state(state);
        (app, test_key)
    }

    /// Helper: POST JSON and return (status, parsed body)
    async fn post_json(app: Router<()>, uri: &str, key: &str, body: Value) -> (StatusCode, Value) {
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(uri)
                    .header("content-type", "application/json")
                    .header("X-Api-Key", key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json)
    }

    async fn get_json(app: Router<()>, uri: &str, key: &str) -> (StatusCode, Value) {
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .header("X-Api-Key", key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json)
    }

    // ── 1. Mint response body ────────────────────────────────────────────────

    #[tokio::test]
    async fn test_qa_mint_response_body() {
        let (app, key) = build_app();
        let body = serde_json::json!({
            "token_mint": "So11111111111111111111111111111111111111112",
            "amount": 1_000_000u64,
            "recipient": "RecipientAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "tx_signature": "SigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        });
        let (status, json) = post_json(app, "/api/mint", &key, body).await;
        assert_eq!(status, StatusCode::OK, "mint should return 200");
        assert_eq!(json["success"], true, "success must be true");
        let data = &json["data"];
        assert!(!data["id"].as_str().unwrap_or("").is_empty(), "id must be set");
        assert_eq!(data["token_mint"], "So11111111111111111111111111111111111111112");
        assert_eq!(data["amount"], 1_000_000u64);
        assert_eq!(data["recipient"], "RecipientAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert!(!data["created_at"].as_str().unwrap_or("").is_empty(), "created_at must be set");
    }

    // ── 2. Burn response body ────────────────────────────────────────────────

    #[tokio::test]
    async fn test_qa_burn_response_body() {
        let (app, key) = build_app();
        let body = serde_json::json!({
            "token_mint": "So11111111111111111111111111111111111111112",
            "amount": 500_000u64,
            "source": "SourceBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "tx_signature": "SigBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        });
        let (status, json) = post_json(app, "/api/burn", &key, body).await;
        assert_eq!(status, StatusCode::OK, "burn should return 200");
        assert_eq!(json["success"], true);
        let data = &json["data"];
        assert!(!data["id"].as_str().unwrap_or("").is_empty(), "id must be set");
        assert_eq!(data["amount"], 500_000u64);
        assert_eq!(data["source"], "SourceBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    }

    // ── 3. Mint rejects zero amount ──────────────────────────────────────────

    #[tokio::test]
    async fn test_qa_mint_rejects_zero_amount() {
        let (app, key) = build_app();
        let body = serde_json::json!({
            "token_mint": "So11111111111111111111111111111111111111112",
            "amount": 0u64,
            "recipient": "RecipientAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        });
        let (status, _) = post_json(app, "/api/mint", &key, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "zero amount should be rejected");
    }

    // ── 4. Blacklist blocks mint ─────────────────────────────────────────────

    #[tokio::test]
    async fn test_qa_blacklist_blocks_mint() {
        let (app, key) = build_app();
        let blocked = "BlockedCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

        // Add to blacklist via REST
        let bl_body = serde_json::json!({"address": blocked, "reason": "sanctions"});
        let (bl_status, bl_json) = post_json(app.clone(), "/api/compliance/blacklist", &key, bl_body).await;
        assert_eq!(bl_status, StatusCode::OK, "blacklist add should return 200");
        assert_eq!(bl_json["success"], true);

        // Mint to blocked address should fail
        let mint_body = serde_json::json!({
            "token_mint": "So11111111111111111111111111111111111111112",
            "amount": 100u64,
            "recipient": blocked
        });
        let (mint_status, mint_json) = post_json(app.clone(), "/api/mint", &key, mint_body).await;
        assert_eq!(mint_status, StatusCode::BAD_REQUEST, "mint to blacklisted address must be rejected");
        let err = mint_json["error"].as_str().unwrap_or("");
        assert!(err.contains("blacklisted"), "error must mention blacklisted, got: {}", err);
    }

    // ── 5. Blacklist REST: add, list, verify ─────────────────────────────────

    #[tokio::test]
    async fn test_qa_blacklist_rest_add_and_list() {
        let (app, key) = build_app();

        // Initially empty
        let (status, json) = get_json(app.clone(), "/api/compliance/blacklist", &key).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["data"].as_array().unwrap().len(), 0);

        // Add entry
        let body = serde_json::json!({"address": "AddrDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", "reason": "test"});
        let (add_status, add_json) = post_json(app.clone(), "/api/compliance/blacklist", &key, body).await;
        assert_eq!(add_status, StatusCode::OK);
        assert_eq!(add_json["data"]["address"], "AddrDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD");

        // List now has 1
        let (list_status, list_json) = get_json(app.clone(), "/api/compliance/blacklist", &key).await;
        assert_eq!(list_status, StatusCode::OK);
        assert_eq!(list_json["data"].as_array().unwrap().len(), 1);
    }

    // ── 6. Supply updates after mint and burn ────────────────────────────────

    #[tokio::test]
    async fn test_qa_supply_reflects_mint_and_burn() {
        let (app, key) = build_app();
        let token = "SupplyMintEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";

        let mint_body = serde_json::json!({
            "token_mint": token, "amount": 1000u64,
            "recipient": "RecipEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"
        });
        post_json(app.clone(), "/api/mint", &key, mint_body).await;

        let burn_body = serde_json::json!({
            "token_mint": token, "amount": 300u64,
            "source": "RecipEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"
        });
        post_json(app.clone(), "/api/burn", &key, burn_body).await;

        let (status, json) = get_json(app.clone(), &format!("/api/supply?token_mint={}", token), &key).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["data"]["total_minted"], 1000u64);
        assert_eq!(json["data"]["total_burned"], 300u64);
        assert_eq!(json["data"]["circulating_supply"], 700u64);
    }

    // ── 7. Webhook fire on mint (mock receiver) ──────────────────────────────

    #[tokio::test]
    async fn test_qa_webhook_fires_on_mint() {
        use std::net::TcpListener;

        // Spin up a tiny HTTP server that records received webhook payloads
        let received: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(vec![]));
        let received_clone = received.clone();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();

        let hook_app = Router::new().route(
            "/hook",
            axum_post(move |AxumJson(body): AxumJson<Value>| {
                let store = received_clone.clone();
                async move {
                    store.lock().await.push(body);
                    StatusCode::OK
                }
            }),
        );

        let server = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(async move {
            axum::serve(server, hook_app).await.unwrap();
        });

        // Small delay to let the server start
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let webhook_url = format!("http://127.0.0.1:{}/hook", port);

        // Build SSS app and register webhook for "mint" events
        let (app, key) = build_app();
        let reg_body = serde_json::json!({"url": webhook_url, "events": ["mint"]});
        let (reg_status, _) = post_json(app.clone(), "/api/webhooks", &key, reg_body).await;
        assert_eq!(reg_status, StatusCode::OK, "webhook registration should succeed");

        // Trigger a mint
        let mint_body = serde_json::json!({
            "token_mint": "WebhookMintFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
            "amount": 42u64,
            "recipient": "RecipFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
        });
        let (mint_status, _) = post_json(app.clone(), "/api/mint", &key, mint_body).await;
        assert_eq!(mint_status, StatusCode::OK, "mint should succeed");

        // Give the background task time to deliver
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let payloads = received.lock().await;
        assert_eq!(payloads.len(), 1, "webhook should have been called once, got {}", payloads.len());
        assert_eq!(payloads[0]["event"], "mint", "event type must be 'mint'");
        assert_eq!(payloads[0]["data"]["amount"], 42u64);
    }

    // ── 8. Webhook fires on burn ─────────────────────────────────────────────

    #[tokio::test]
    async fn test_qa_webhook_fires_on_burn() {
        use std::net::TcpListener;

        let received: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(vec![]));
        let received_clone = received.clone();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();

        let hook_app = Router::new().route(
            "/hook",
            axum_post(move |AxumJson(body): AxumJson<Value>| {
                let store = received_clone.clone();
                async move {
                    store.lock().await.push(body);
                    StatusCode::OK
                }
            }),
        );

        let server = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(async move {
            axum::serve(server, hook_app).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let webhook_url = format!("http://127.0.0.1:{}/hook", port);

        let (app, key) = build_app();
        let reg_body = serde_json::json!({"url": webhook_url, "events": ["burn"]});
        post_json(app.clone(), "/api/webhooks", &key, reg_body).await;

        let burn_body = serde_json::json!({
            "token_mint": "WebhookBurnGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
            "amount": 99u64,
            "source": "SourceGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"
        });
        let (burn_status, _) = post_json(app.clone(), "/api/burn", &key, burn_body).await;
        assert_eq!(burn_status, StatusCode::OK);

        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let payloads = received.lock().await;
        assert_eq!(payloads.len(), 1, "burn webhook should fire once, got {}", payloads.len());
        assert_eq!(payloads[0]["event"], "burn");
        assert_eq!(payloads[0]["data"]["amount"], 99u64);
    }

    // ── 9. Webhook only fires for subscribed events ──────────────────────────

    #[tokio::test]
    async fn test_qa_webhook_not_fired_for_unsubscribed_event() {
        use std::net::TcpListener;

        let received: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(vec![]));
        let received_clone = received.clone();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();

        let hook_app = Router::new().route(
            "/hook",
            axum_post(move |AxumJson(body): AxumJson<Value>| {
                let store = received_clone.clone();
                async move { store.lock().await.push(body); StatusCode::OK }
            }),
        );

        let server = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(async move { axum::serve(server, hook_app).await.unwrap(); });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let webhook_url = format!("http://127.0.0.1:{}/hook", port);
        let (app, key) = build_app();

        // Register only for "burn" events — a mint should NOT trigger it
        let reg_body = serde_json::json!({"url": webhook_url, "events": ["burn"]});
        post_json(app.clone(), "/api/webhooks", &key, reg_body).await;

        let mint_body = serde_json::json!({
            "token_mint": "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHh",
            "amount": 1u64,
            "recipient": "RecipHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH"
        });
        post_json(app.clone(), "/api/mint", &key, mint_body).await;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let payloads = received.lock().await;
        assert_eq!(payloads.len(), 0, "burn-only webhook must not fire on mint");
    }

    // ── 10. Audit log query filtering ────────────────────────────────────────

    #[tokio::test]
    async fn test_audit_log_filtering() {
        let (app, key) = build_app();

        // Add two addresses to blacklist (generates BLACKLIST_ADD audit entries)
        let addr_a = "AuditAddrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let addr_b = "AuditAddrBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

        post_json(
            app.clone(),
            "/api/compliance/blacklist",
            &key,
            serde_json::json!({"address": addr_a, "reason": "test A"}),
        )
        .await;
        post_json(
            app.clone(),
            "/api/compliance/blacklist",
            &key,
            serde_json::json!({"address": addr_b, "reason": "test B"}),
        )
        .await;

        // Unfiltered — should return at least 2 entries
        let (status, json) = get_json(app.clone(), "/api/compliance/audit", &key).await;
        assert_eq!(status, StatusCode::OK);
        let all = json["data"].as_array().unwrap().len();
        assert!(all >= 2, "expected at least 2 audit entries, got {}", all);

        // Filter by address — should return only addr_a entries
        let uri_a = format!("/api/compliance/audit?address={}", addr_a);
        let (status_a, json_a) = get_json(app.clone(), &uri_a, &key).await;
        assert_eq!(status_a, StatusCode::OK);
        let entries_a = json_a["data"].as_array().unwrap();
        assert!(!entries_a.is_empty(), "should have entries for addr_a");
        for entry in entries_a {
            assert_eq!(entry["address"], addr_a, "all entries should match addr_a");
        }

        // Filter by action — should only return BLACKLIST_ADD entries
        let (status_ac, json_ac) =
            get_json(app.clone(), "/api/compliance/audit?action=BLACKLIST_ADD", &key).await;
        assert_eq!(status_ac, StatusCode::OK);
        let entries_ac = json_ac["data"].as_array().unwrap();
        assert!(!entries_ac.is_empty(), "should have BLACKLIST_ADD entries");
        for entry in entries_ac {
            assert_eq!(entry["action"], "BLACKLIST_ADD");
        }

        // limit=1 — should return exactly one entry
        let (status_lim, json_lim) =
            get_json(app.clone(), "/api/compliance/audit?limit=1", &key).await;
        assert_eq!(status_lim, StatusCode::OK);
        let entries_lim = json_lim["data"].as_array().unwrap();
        assert_eq!(entries_lim.len(), 1, "limit=1 should return exactly 1 entry");
    }

    // ── SSS-014: Event date-range filtering ──────────────────────────────────

    #[tokio::test]
    async fn test_event_date_range_filter_from() {
        let (app, key) = build_app();

        // Create a mint event
        post_json(
            app.clone(),
            "/api/mint",
            &key,
            serde_json::json!({
                "token_mint": "DateMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "amount": 1000,
                "recipient": "RecipAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            }),
        )
        .await;

        // from=far-future should return no events
        let (status, json) = get_json(
            app.clone(),
            "/api/events?from=2099-01-01T00:00:00Z",
            &key,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let mint_events = json["data"]["mint_events"].as_array().unwrap();
        assert_eq!(
            mint_events.len(),
            0,
            "from=2099 should return 0 mint events"
        );

        // from=past should return at least our event
        let (status2, json2) = get_json(
            app.clone(),
            "/api/events?from=2000-01-01T00:00:00Z",
            &key,
        )
        .await;
        assert_eq!(status2, StatusCode::OK);
        let mint_events2 = json2["data"]["mint_events"].as_array().unwrap();
        assert!(
            !mint_events2.is_empty(),
            "from=2000 should return at least 1 mint event"
        );
    }

    #[tokio::test]
    async fn test_event_date_range_filter_to() {
        let (app, key) = build_app();

        // Create a burn event
        post_json(
            app.clone(),
            "/api/burn",
            &key,
            serde_json::json!({
                "token_mint": "DateBurnAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "amount": 500,
                "source": "SrcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            }),
        )
        .await;

        // to=far-past should return no burn events
        let (status, json) = get_json(
            app.clone(),
            "/api/events?to=2000-01-01T00:00:00Z",
            &key,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let burn_events = json["data"]["burn_events"].as_array().unwrap();
        assert_eq!(
            burn_events.len(),
            0,
            "to=2000 should return 0 burn events"
        );

        // to=far-future should include our event
        let (status2, json2) = get_json(
            app.clone(),
            "/api/events?to=2099-12-31T23:59:59Z",
            &key,
        )
        .await;
        assert_eq!(status2, StatusCode::OK);
        let burn_events2 = json2["data"]["burn_events"].as_array().unwrap();
        assert!(
            !burn_events2.is_empty(),
            "to=2099 should return at least 1 burn event"
        );
    }

    #[tokio::test]
    async fn test_event_date_range_filter_from_to() {
        let (app, key) = build_app();

        // Create a mint event (now)
        post_json(
            app.clone(),
            "/api/mint",
            &key,
            serde_json::json!({
                "token_mint": "RangeMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "amount": 250,
                "recipient": "RecipAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            }),
        )
        .await;

        // from+to spanning now — should include the event
        let (status, json) = get_json(
            app.clone(),
            "/api/events?from=2000-01-01T00:00:00Z&to=2099-12-31T23:59:59Z",
            &key,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let mint_events = json["data"]["mint_events"].as_array().unwrap();
        assert!(
            !mint_events.is_empty(),
            "from=2000&to=2099 should return at least 1 mint event"
        );

        // narrow window that excludes everything
        let (status2, json2) = get_json(
            app.clone(),
            "/api/events?from=2050-01-01T00:00:00Z&to=2050-12-31T23:59:59Z",
            &key,
        )
        .await;
        assert_eq!(status2, StatusCode::OK);
        let mint_events2 = json2["data"]["mint_events"].as_array().unwrap();
        assert_eq!(
            mint_events2.len(),
            0,
            "narrow 2050 window should return 0 events"
        );
    }

    #[tokio::test]
    async fn test_event_limit_cap() {
        // Verify limit is capped at 1000 (no panic, valid response)
        let (app, key) = build_app();
        let (status, json) =
            get_json(app.clone(), "/api/events?limit=99999", &key).await;
        assert_eq!(status, StatusCode::OK);
        // Response is valid JSON with mint/burn arrays
        assert!(json["data"]["mint_events"].is_array());
        assert!(json["data"]["burn_events"].is_array());
    }
}
