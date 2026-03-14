use axum::{extract::State, Json};
use tracing::info;

use crate::{
    error::AppError,
    models::{ApiResponse, BurnEvent, BurnRequest},
    state::AppState,
    webhook_dispatch,
};

pub async fn burn(
    State(state): State<AppState>,
    Json(req): Json<BurnRequest>,
) -> Result<Json<ApiResponse<BurnEvent>>, AppError> {
    if req.token_mint.is_empty() {
        return Err(AppError::BadRequest("token_mint is required".to_string()));
    }
    if req.source.is_empty() {
        return Err(AppError::BadRequest("source is required".to_string()));
    }
    if req.amount == 0 {
        return Err(AppError::BadRequest("amount must be greater than 0".to_string()));
    }

    let event = state.db.record_burn(
        &req.token_mint,
        req.amount,
        &req.source,
        req.tx_signature.as_deref(),
    )?;

    state.db.add_audit(
        "BURN",
        &req.source,
        &format!("Burned {} tokens on mint {}", req.amount, req.token_mint),
    )?;

    info!(
        token_mint = %req.token_mint,
        amount = req.amount,
        source = %req.source,
        "Burn event recorded"
    );

    state.metrics.inc_burn(req.amount);
    webhook_dispatch::dispatch(&state.db, "burn", serde_json::to_value(&event).unwrap_or_default());

    Ok(Json(ApiResponse::ok(event)))
}
