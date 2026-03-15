use axum::{
    extract::{Query, State},
    Json,
};

use crate::{
    error::AppError,
    models::{ApiResponse, EventsQuery, EventsResponse},
    state::AppState,
};

pub async fn events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<ApiResponse<EventsResponse>>, AppError> {
    let token_mint = query.token_mint.as_deref();
    let limit = query.limit.unwrap_or(100).min(1000);
    let from = query.from.as_deref();
    let to = query.to.as_deref();

    let mint_events = state.db.list_mint_events(token_mint, limit, from, to)?;
    let burn_events = state.db.list_burn_events(token_mint, limit, from, to)?;

    Ok(Json(ApiResponse::ok(EventsResponse {
        mint_events,
        burn_events,
    })))
}
