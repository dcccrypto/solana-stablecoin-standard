use axum::{
    extract::{Query, State},
    Json,
};
use std::sync::Arc;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, EventsQuery, EventsResponse},
};

pub async fn events(
    State(db): State<Arc<Database>>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<ApiResponse<EventsResponse>>, AppError> {
    let token_mint = query.token_mint.as_deref();
    let limit = query.limit.unwrap_or(100);

    let mint_events = db.list_mint_events(token_mint, limit)?;
    let burn_events = db.list_burn_events(token_mint, limit)?;

    Ok(Json(ApiResponse::ok(EventsResponse {
        mint_events,
        burn_events,
    })))
}
