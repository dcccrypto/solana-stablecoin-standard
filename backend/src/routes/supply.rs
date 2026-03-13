use axum::{extract::{Query, State}, Json};
use std::sync::Arc;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, SupplyQuery, SupplyResponse},
};

pub async fn get_supply(
    State(db): State<Arc<Database>>,
    Query(query): Query<SupplyQuery>,
) -> Result<Json<ApiResponse<SupplyResponse>>, AppError> {
    let (total_minted, total_burned) = db.get_supply(query.token_mint.as_deref())?;
    let token_mint = query.token_mint.unwrap_or_else(|| "all".to_string());

    Ok(Json(ApiResponse::ok(SupplyResponse {
        token_mint,
        total_minted,
        total_burned,
        circulating_supply: total_minted.saturating_sub(total_burned),
    })))
}
