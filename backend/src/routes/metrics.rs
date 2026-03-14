//! GET /api/metrics — Prometheus-style counters (JSON format)
//!
//! Returns live in-memory counters: mint/burn ops + amounts, errors,
//! rate-limit hits, webhook dispatches/failures, and server uptime.
//! Requires a valid `X-Api-Key` header (same as all other authenticated routes).

use axum::{extract::State, Json};

use crate::{
    models::ApiResponse,
    state::AppState,
    metrics::MetricsSnapshot,
};

/// Handler for `GET /api/metrics`.
pub async fn get_metrics(
    State(state): State<AppState>,
) -> Json<ApiResponse<MetricsSnapshot>> {
    Json(ApiResponse::ok(state.metrics.snapshot()))
}
