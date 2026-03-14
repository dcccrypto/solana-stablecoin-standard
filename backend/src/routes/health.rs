//! GET /api/health — liveness + readiness check.
//!
//! SSS-016: extended health response with DB ping, uptime, and version.
//! This endpoint is public (no API key required) so load balancers and
//! monitoring systems can call it freely.

use axum::{extract::State, http::StatusCode, Json};
use chrono::Utc;

use crate::state::AppState;

/// Handler for `GET /api/health`.
///
/// Returns 200 when healthy, 503 when the database is unreachable.
pub async fn health(
    State(state): State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let db_ok = state.db.ping().is_ok();
    let uptime = state.metrics.snapshot().uptime_seconds;

    let status_str = if db_ok { "ok" } else { "degraded" };
    let http_status = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let body = serde_json::json!({
        "success": db_ok,
        "data": {
            "status": status_str,
            "version": env!("CARGO_PKG_VERSION"),
            "timestamp": Utc::now().to_rfc3339(),
            "db": if db_ok { "ok" } else { "error" },
            "uptime_seconds": uptime,
        }
    });

    (http_status, Json(body))
}
