//! SSS-102: GET /api/liquidations — liquidation history endpoint.
//!
//! Returns historical liquidation events sourced from the `liquidation_history`
//! table, which is populated by indexing `cdp_liquidate` events from the
//! `event_log` table (SSS-095).
//!
//! # Query parameters
//! | Param            | Type   | Default | Description                              |
//! |------------------|--------|---------|------------------------------------------|
//! | `cdp_address`    | string | —       | Filter by CDP position address (optional)|
//! | `collateral_mint`| string | —       | Filter by collateral mint (optional)     |
//! | `limit`          | u32    | 100     | Max rows returned (capped at 1000)       |
//! | `offset`         | u32    | 0       | Pagination offset                        |
//!
//! # Response
//! ```json
//! {
//!   "ok": true,
//!   "data": {
//!     "items": [...],
//!     "total": 42,
//!     "limit": 100,
//!     "offset": 0
//!   }
//! }
//! ```

use axum::{
    extract::{Query, State},
    Json,
};
use serde::Serialize;

use crate::{
    error::AppError,
    models::{ApiResponse, LiquidationHistoryEntry, LiquidationsQuery},
    state::AppState,
};

/// Paginated response wrapper for liquidation history.
#[derive(Debug, Serialize)]
pub struct LiquidationPage {
    pub items: Vec<LiquidationHistoryEntry>,
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
}

/// `GET /api/liquidations` — query liquidation history with optional filters.
pub async fn get_liquidations(
    State(state): State<AppState>,
    Query(query): Query<LiquidationsQuery>,
) -> Result<Json<ApiResponse<LiquidationPage>>, AppError> {
    let cdp_address = query.cdp_address.as_deref();
    let collateral_mint = query.collateral_mint.as_deref();
    let limit = query.limit.unwrap_or(100).min(1000);
    let offset = query.offset.unwrap_or(0);

    // Sync any new cdp_liquidate events from event_log first (best-effort).
    let _ = state.db.sync_liquidations_from_event_log();

    let items = state
        .db
        .list_liquidations(cdp_address, collateral_mint, limit, offset)?;
    let total = state.db.count_liquidations(cdp_address, collateral_mint)?;

    Ok(Json(ApiResponse::ok(LiquidationPage {
        items,
        total,
        limit,
        offset,
    })))
}
