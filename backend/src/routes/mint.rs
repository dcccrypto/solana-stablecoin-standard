use axum::{extract::State, Json};
use std::sync::Arc;
use tracing::info;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, MintEvent, MintRequest},
    webhook,
};

pub async fn mint(
    State(db): State<Arc<Database>>,
    Json(req): Json<MintRequest>,
) -> Result<Json<ApiResponse<MintEvent>>, AppError> {
    if req.token_mint.is_empty() {
        return Err(AppError::BadRequest("token_mint is required".to_string()));
    }
    if req.recipient.is_empty() {
        return Err(AppError::BadRequest("recipient is required".to_string()));
    }
    if req.amount == 0 {
        return Err(AppError::BadRequest("amount must be greater than 0".to_string()));
    }

    // Check compliance: recipient must not be blacklisted
    if db.is_blacklisted(&req.recipient)? {
        db.add_audit("MINT_BLOCKED", &req.recipient, &format!("Blocked mint of {} to blacklisted address", req.amount))?;
        return Err(AppError::BadRequest(format!(
            "Recipient {} is blacklisted",
            req.recipient
        )));
    }

    let event = db.record_mint(
        &req.token_mint,
        req.amount,
        &req.recipient,
        req.tx_signature.as_deref(),
    )?;

    db.add_audit(
        "MINT",
        &req.recipient,
        &format!("Minted {} tokens on mint {}", req.amount, req.token_mint),
    )?;

    info!(
        token_mint = %req.token_mint,
        amount = req.amount,
        recipient = %req.recipient,
        "Mint event recorded"
    );

    // Fire webhooks (best-effort, non-blocking)
    if let Ok(urls) = db.get_webhooks_for_event("mint") {
        webhook::dispatch("mint", event.clone(), urls).await;
    }

    Ok(Json(ApiResponse::ok(event)))
}
