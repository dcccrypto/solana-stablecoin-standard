use axum::{
    extract::{Query, State},
    Json,
};

use crate::{
    error::AppError,
    models::{ApiResponse, ChainEventsQuery, EventLogEntry},
    state::AppState,
};

/// GET /api/chain-events — query on-chain event log (SSS-095).
///
/// Supported event types: `circuit_breaker_toggle`, `cdp_deposit`, `cdp_borrow`,
/// `cdp_liquidate`, `oracle_params_update`.
///
/// Query params:
/// - `type`    — filter by event_type (optional)
/// - `address` — filter by token mint / CDP position address (optional)
/// - `limit`   — max results to return (default: 100, max: 1000)
pub async fn chain_events(
    State(state): State<AppState>,
    Query(query): Query<ChainEventsQuery>,
) -> Result<Json<ApiResponse<Vec<EventLogEntry>>>, AppError> {
    let event_type = query.event_type.as_deref();
    let address = query.address.as_deref();
    let limit = query.limit.unwrap_or(100).min(1000);
    let entries = state.db.list_event_log(event_type, address, limit)?;
    Ok(Json(ApiResponse::ok(entries)))
}
