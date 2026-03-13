use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use axum::http::HeaderValue;
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
                    match state.rate_limiter.check(&key_str) {
                        Ok(()) => next.run(req).await,
                        Err(retry_after_secs) => {
                            let mut resp = (
                                StatusCode::TOO_MANY_REQUESTS,
                                Json(json!({"success": false, "error": "Rate limit exceeded"})),
                            )
                                .into_response();
                            // Emit Retry-After only when we have a meaningful value.
                            if retry_after_secs < u64::MAX {
                                if let Ok(val) = HeaderValue::from_str(&retry_after_secs.to_string()) {
                                    resp.headers_mut().insert("Retry-After", val);
                                }
                            }
                            resp
                        }
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
