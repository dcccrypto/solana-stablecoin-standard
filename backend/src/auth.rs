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
/// Public endpoints (no key required):
///   - `/api/health`
///
/// All other endpoints require a valid `X-Api-Key` header.
///
/// # E-2: Role enforcement
/// Admin endpoints (`/api/admin/*`) require the key to have role = "admin".
/// Other endpoints accept any valid key (role: read, write, or admin).
///
/// # E-3: /api/metrics now requires auth
/// Previously unauthenticated; Prometheus scrapers must supply a valid API key.
pub async fn require_api_key(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Health check is always public
    if req.uri().path() == "/api/health" {
        return next.run(req).await;
    }

    let key_header = req.headers().get("X-Api-Key");
    let key_str = match key_header {
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"success": false, "error": "Missing X-Api-Key header"})),
            )
                .into_response();
        }
        Some(value) => match value.to_str() {
            Ok(s) => s.to_string(),
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"success": false, "error": "Invalid X-Api-Key header"})),
                )
                    .into_response();
            }
        },
    };

    // Fetch key role (None = key not found)
    let role = match state.db.get_api_key_role(&key_str) {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"success": false, "error": "Invalid API key"})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    // E-2: Admin endpoints require admin role
    let path = req.uri().path();
    if path.starts_with("/api/admin/") && role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "error": "Insufficient privileges: admin role required for this endpoint"
            })),
        )
            .into_response();
    }

    // Rate limit check (keyed by API key string)
    match state.rate_limiter.check(&key_str) {
        Ok(()) => next.run(req).await,
        Err(retry_after_secs) => {
            let mut resp = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"success": false, "error": "Rate limit exceeded"})),
            )
                .into_response();
            if retry_after_secs < u64::MAX {
                if let Ok(val) = HeaderValue::from_str(&retry_after_secs.to_string()) {
                    resp.headers_mut().insert("Retry-After", val);
                }
            }
            resp
        }
    }
}
