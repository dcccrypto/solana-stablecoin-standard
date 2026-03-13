use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;
use std::sync::Arc;

use crate::db::Database;

/// Axum middleware that validates the `X-Api-Key` header against the database.
/// The `/api/health` endpoint is exempt (public).
pub async fn require_api_key(
    State(db): State<Arc<Database>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Health check is public
    if req.uri().path() == "/api/health" {
        return next.run(req).await;
    }

    let key_header = req.headers().get("X-Api-Key");
    match key_header {
        None => (
            StatusCode::UNAUTHORIZED,
            Json(json!({"success": false, "error": "Missing X-Api-Key header"})),
        )
            .into_response(),
        Some(value) => {
            let key_str = match value.to_str() {
                Ok(s) => s.to_string(),
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({"success": false, "error": "Invalid X-Api-Key header"})),
                    )
                        .into_response()
                }
            };

            match db.validate_api_key(&key_str) {
                Ok(true) => next.run(req).await,
                Ok(false) => (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"success": false, "error": "Invalid API key"})),
                )
                    .into_response(),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"success": false, "error": e.to_string()})),
                )
                    .into_response(),
            }
        }
    }
}
