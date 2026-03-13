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
    let limit = query.limit.unwrap_or(100);

    let mint_events = state.db.list_mint_events(token_mint, limit)?;
    let burn_events = state.db.list_burn_events(token_mint, limit)?;

    Ok(Json(ApiResponse::ok(EventsResponse {
        mint_events,
        burn_events,
    })))
}
