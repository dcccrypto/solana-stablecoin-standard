use axum::{
    extract::{Query, State},
    Json,
};

use crate::{
    error::AppError,
    models::{ApiResponse, EventsPageResponse, EventsQuery, PageMeta},
    state::AppState,
};

/// `GET /api/events`
///
/// Query parameters:
/// - `token_mint`  — filter by mint address (optional)
/// - `limit`       — page size, default 50, max 500
/// - `offset`      — zero-based record offset, default 0
///
/// Response includes separate `mint_page` and `burn_page` metadata objects
/// each containing `total`, `offset`, and `limit` for client-side pagination.
pub async fn events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<ApiResponse<EventsPageResponse>>, AppError> {
    let token_mint = query.token_mint.as_deref();
    let limit = query.limit.unwrap_or(50).min(500);
    let offset = query.offset.unwrap_or(0);

    let mint_total = state.db.count_mint_events(token_mint)?;
    let burn_total = state.db.count_burn_events(token_mint)?;

    let mint_events = state.db.list_mint_events(token_mint, limit, offset)?;
    let burn_events = state.db.list_burn_events(token_mint, limit, offset)?;

    Ok(Json(ApiResponse::ok(EventsPageResponse {
        mint_events,
        burn_events,
        mint_page: PageMeta {
            total: mint_total,
            offset,
            limit,
        },
        burn_page: PageMeta {
            total: burn_total,
            offset,
            limit,
        },
    })))
}
