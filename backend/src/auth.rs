use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;

use crate::state::AppState;

/// Axum middleware that validates the `X-Api-Key` header against the database
/// and enforces per-key rate limiting.
///
/// The `/api/health` endpoint is exempt (public, not rate-limited).
pub async fn require_api_key(
    State(state): State<AppState>,
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

            match state.db.validate_api_key(&key_str) {
                Ok(true) => {
                    // Key is valid — check rate limit before proceeding.
                    if state.rate_limiter.check(&key_str) {
                        next.run(req).await
                    } else {
                        (
                            StatusCode::TOO_MANY_REQUESTS,
                            Json(json!({"success": false, "error": "Rate limit exceeded"})),
                        )
                            .into_response()
                    }
                }
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
