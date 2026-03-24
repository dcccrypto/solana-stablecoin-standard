// SSS-139: POST /api/alerts — submit an alert record; GET /api/alerts — list alert records.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::state::AppState;
use crate::models::{PostAlertRequest, ApiResponse};
use crate::monitor::alert_manager::{AlertManager, AlertSeverity};

/// POST /api/alerts — submit an alert programmatically (e.g. from external monitors).
pub async fn post_alert(
    State(state): State<AppState>,
    Json(req): Json<PostAlertRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    if req.invariant.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err("invariant must not be empty")),
        ));
    }
    if req.detail.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err("detail must not be empty")),
        ));
    }

    let severity = match req.severity.as_deref().unwrap_or("warning") {
        "critical" => AlertSeverity::Critical,
        "info" => AlertSeverity::Info,
        _ => AlertSeverity::Warning,
    };

    let mgr = AlertManager::new(state.clone());
    mgr.fire_alert(&req.invariant, &req.detail, severity.clone()).await;

    Ok(Json(ApiResponse::ok(serde_json::json!({
        "invariant": req.invariant,
        "detail": req.detail,
        "severity": format!("{}", severity),
        "recorded": true,
    }))))
}

/// Query params for GET /api/alerts.
#[derive(Debug, Deserialize)]
pub struct AlertsQuery {
    pub invariant: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 { 100 }

/// GET /api/alerts — list stored AlertRecord events.
pub async fn get_alerts(
    State(state): State<AppState>,
    Query(q): Query<AlertsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, (StatusCode, Json<ApiResponse<()>>)> {
    let limit = q.limit.min(1000) as usize;
    let entries = state
        .db
        .query_event_log(
            Some("AlertRecord"),
            q.invariant.as_deref(),
            limit,
            0,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(e.to_string())),
            )
        })?;

    let records: Vec<serde_json::Value> = entries
        .into_iter()
        .map(|e| {
            let inv = e.data.get("invariant").and_then(|v| v.as_str()).map(str::to_owned).unwrap_or_else(|| e.address.clone());
            let detail = e.data.get("detail").and_then(|v| v.as_str()).unwrap_or("").to_owned();
            let severity = e.data.get("severity").and_then(|v| v.as_str()).unwrap_or("WARNING").to_owned();
            let timestamp = e.data.get("timestamp").and_then(|v| v.as_str()).map(str::to_owned).unwrap_or_else(|| e.created_at.clone());
            serde_json::json!({
                "id": e.id,
                "invariant": inv,
                "detail": detail,
                "severity": severity,
                "timestamp": timestamp,
                "created_at": e.created_at,
            })
        })
        .collect();

    Ok(Json(ApiResponse::ok(serde_json::json!({
        "total": records.len(),
        "items": records,
    }))))
}

// ─── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
        routing::get,
        Router,
    };
    use crate::db::Database;
    use crate::auth::require_api_key;
    use tower::ServiceExt;
    use tower_http::cors::{Any, CorsLayer};
    use axum::middleware;

    fn build_alerts_app() -> (Router<()>, String) {
        let db = Database::new(":memory:").unwrap();
        let key_entry = db.create_api_key("test").unwrap();
        let test_key = key_entry.key.clone();
        let state = AppState::new(db);
        let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
        let app = Router::new()
            .route("/api/alerts", get(get_alerts).post(post_alert))
            .layer(middleware::from_fn_with_state(state.clone(), require_api_key))
            .layer(cors)
            .with_state(state);
        (app, test_key)
    }

    #[tokio::test]
    async fn test_post_alert_ok() {
        let (app, key) = build_alerts_app();
        let body = serde_json::json!({
            "invariant": "supply_consistency",
            "detail": "burned > minted",
            "severity": "critical"
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/alerts")
                    .header("content-type", "application/json")
                    .header("X-Api-Key", &key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["invariant"], "supply_consistency");
        assert_eq!(json["data"]["severity"], "CRITICAL");
    }

    #[tokio::test]
    async fn test_post_alert_missing_invariant() {
        let (app, key) = build_alerts_app();
        let body = serde_json::json!({"invariant": "", "detail": "some detail"});
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/alerts")
                    .header("content-type", "application/json")
                    .header("X-Api-Key", &key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_post_alert_missing_detail() {
        let (app, key) = build_alerts_app();
        let body = serde_json::json!({"invariant": "reserve_ratio", "detail": ""});
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/alerts")
                    .header("content-type", "application/json")
                    .header("X-Api-Key", &key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_get_alerts_empty() {
        let (app, key) = build_alerts_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/alerts")
                    .header("X-Api-Key", &key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["total"], 0);
    }

    #[tokio::test]
    async fn test_get_alerts_after_post() {
        let (app, key) = build_alerts_app();
        // Post two alerts
        for inv in ["reserve_ratio", "circuit_breaker"] {
            let body = serde_json::json!({
                "invariant": inv,
                "detail": format!("{} violated", inv),
                "severity": "warning"
            });
            app.clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/alerts")
                        .header("content-type", "application/json")
                        .header("X-Api-Key", &key)
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/alerts")
                    .header("X-Api-Key", &key)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["total"], 2);
    }

    #[tokio::test]
    async fn test_alerts_require_auth() {
        let (app, _) = build_alerts_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/alerts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
