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

// ─── Extension types ──────────────────────────────────────────────────────────

/// Request extension set by `require_api_key` once a key is validated.
/// Downstream middleware (e.g. `require_admin`) reads this to check role.
#[derive(Clone)]
pub struct ApiKeyInfo {
    pub is_admin: bool,
}

// ─── Middleware: require_api_key ──────────────────────────────────────────────

/// Axum middleware that validates the `X-Api-Key` header against the database
/// and enforces per-key rate limiting.
///
/// The `/api/health` endpoint is exempt (public, not rate-limited).
/// On success, inserts an `ApiKeyInfo` extension into the request for downstream use.
pub async fn require_api_key(
    State(state): State<AppState>,
    mut req: Request<Body>,
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
                Ok(Some(is_admin)) => {
                    // Key is valid — check rate limit before proceeding.
                    match state.rate_limiter.check(&key_str) {
                        Ok(()) => {
                            // Attach key info as a request extension for downstream middleware.
                            req.extensions_mut().insert(ApiKeyInfo { is_admin });
                            next.run(req).await
                        }
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
                Ok(None) => (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"success": false, "error": "Invalid API key"})),
                )
                    .into_response(),
                Err(e) => {
                    let msg: String = e.to_string();
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"success": false, "error": msg})),
                    )
                        .into_response()
                }
            }
        }
    }
}

// ─── Middleware: require_admin ────────────────────────────────────────────────

/// Middleware that gates routes to admin-role API keys only.
///
/// Must be layered **after** `require_api_key` (i.e. inner layer) so that
/// `ApiKeyInfo` is already populated in request extensions.
///
/// Returns `403 Forbidden` when the key is valid but not admin.
pub async fn require_admin(
    req: Request<Body>,
    next: Next,
) -> Response {
    match req.extensions().get::<ApiKeyInfo>() {
        Some(info) if info.is_admin => next.run(req).await,
        Some(_) => (
            StatusCode::FORBIDDEN,
            Json(json!({"success": false, "error": "Admin role required"})),
        )
            .into_response(),
        None => {
            // require_api_key wasn't run first — shouldn't happen in normal config
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"success": false, "error": "Authentication required"})),
            )
                .into_response()
        }
    }
}
