use axum::{extract::State, Json};
use std::sync::Arc;
use tracing::info;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, BurnEvent, BurnRequest},
    webhook,
};

pub async fn burn(
    State(db): State<Arc<Database>>,
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

    let event = db.record_burn(
        &req.token_mint,
        req.amount,
        &req.source,
        req.tx_signature.as_deref(),
    )?;

    db.add_audit(
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

    // Fire webhooks (best-effort, non-blocking)
    if let Ok(urls) = db.get_webhooks_for_event("burn") {
        webhook::dispatch("burn", event.clone(), urls).await;
    }

    Ok(Json(ApiResponse::ok(event)))
}
