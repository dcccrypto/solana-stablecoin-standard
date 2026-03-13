use axum::{
    extract::{Query, State},
    Json,
};

use crate::{
    error::AppError,
    models::{ApiResponse, SupplyQuery, SupplyResponse},
    state::AppState,
};

pub async fn supply(
    State(state): State<AppState>,
    Query(query): Query<SupplyQuery>,
) -> Result<Json<ApiResponse<SupplyResponse>>, AppError> {
    let token_mint = query.token_mint.as_deref();
    let (total_minted, total_burned) = state.db.get_supply(token_mint)?;
    let circulating_supply = total_minted.saturating_sub(total_burned);

    Ok(Json(ApiResponse::ok(SupplyResponse {
        token_mint: token_mint.unwrap_or("all").to_string(),
        total_minted,
        total_burned,
        circulating_supply,
    })))
}
