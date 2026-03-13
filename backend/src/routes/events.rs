use axum::{extract::{Query, State}, Json};
use std::sync::Arc;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, EventsQuery, EventsResponse},
};

pub async fn list_events(
    State(db): State<Arc<Database>>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<ApiResponse<EventsResponse>>, AppError> {
    let limit = query.limit.unwrap_or(50);
    let mint_events = db.list_mint_events(query.token_mint.as_deref(), limit)?;
    let burn_events = db.list_burn_events(query.token_mint.as_deref(), limit)?;

    Ok(Json(ApiResponse::ok(EventsResponse {
        mint_events,
        burn_events,
    })))
}
