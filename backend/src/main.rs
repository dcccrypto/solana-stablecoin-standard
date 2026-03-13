mod auth;
mod db;
mod error;
mod models;
mod routes;
mod webhook;

use axum::{
    middleware,
    routing::{delete, get, post},
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use auth::require_api_key;
use db::Database;
use routes::{
    apikeys::{create_api_key, delete_api_key, list_api_keys},
    compliance::{add_blacklist, get_audit, get_blacklist},
    events::events,
    health::health,
    mint::mint,
    burn::burn,
    supply::supply,
    webhooks::{delete_webhook, list_webhooks, register_webhook},
};

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
    let db = Arc::new(db);

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
        .route("/api/compliance/blacklist", get(get_blacklist).post(add_blacklist))
        .route("/api/compliance/audit", get(get_audit))
        .route("/api/webhooks", get(list_webhooks).post(register_webhook))
        .route("/api/webhooks/:id", delete(delete_webhook))
        .route("/api/admin/keys", get(list_api_keys).post(create_api_key))
        .route("/api/admin/keys/:id", delete(delete_api_key))
        .layer(middleware::from_fn_with_state(db.clone(), require_api_key))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(db);

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

    axum::serve(listener, app)
        .await
        .expect("Server error");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use tower::ServiceExt;

    fn build_app() -> (Router<()>, String) {
        let db = Database::new(":memory:").expect("Failed to create test DB");
        // Pre-create an API key for tests
        let key_entry = db.create_api_key("test").expect("Failed to create test API key");
        let test_key = key_entry.key.clone();
        let db = Arc::new(db);

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
            .route("/api/compliance/blacklist", get(get_blacklist).post(add_blacklist))
            .route("/api/compliance/audit", get(get_audit))
            .route("/api/webhooks", get(list_webhooks).post(register_webhook))
            .route("/api/webhooks/:id", delete(delete_webhook))
            .route("/api/admin/keys", get(list_api_keys).post(create_api_key))
            .route("/api/admin/keys/:id", delete(delete_api_key))
            .layer(middleware::from_fn_with_state(db.clone(), require_api_key))
            .layer(cors)
            .with_state(db);

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
        let db = Arc::new(db);

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
        let db = Arc::new(db);

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
        let db = Arc::new(db);

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
}
