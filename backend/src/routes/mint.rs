//! POST /api/mint — record a mint event.
//!
//! **BUG-035 / E-4:** `tx_signature` is verified on-chain via `getTransaction`
//! RPC when provided.  Omitting it skips the RPC call so integration tests and
//! off-chain recording flows continue to work.

use axum::{extract::State, Json};
use tracing::info;

use crate::{
    error::AppError,
    models::{ApiResponse, MintEvent, MintRequest},
    routes::onchain,
    state::AppState,
    webhook_dispatch,
};

pub async fn mint(
    State(state): State<AppState>,
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

    // BUG-035 / E-4: verify tx_signature on-chain if provided.
    let sig_ref: Option<&str> = req.tx_signature.as_deref();
    if let Some(sig) = sig_ref {
        onchain::verify_tx_signature(sig)
            .await
            .map_err(|e| AppError::BadRequest(format!("tx_signature verification failed: {e}")))?;
    }

    // Check compliance: recipient must not be blacklisted
    if state.db.is_blacklisted(&req.recipient)? {
        state.db.add_audit("MINT_BLOCKED", &req.recipient, &format!("Blocked mint of {} to blacklisted address", req.amount))?;
        return Err(AppError::BadRequest(format!(
            "Recipient {} is blacklisted",
            req.recipient
        )));
    }

    let event = state.db.record_mint(
        &req.token_mint,
        req.amount,
        &req.recipient,
        sig_ref,
    )?;

    let sig_display = req.tx_signature.as_deref().unwrap_or("none");
    state.db.add_audit(
        "MINT",
        &req.recipient,
        &format!("Minted {} tokens on mint {} tx={}", req.amount, req.token_mint, sig_display),
    )?;

    info!(
        token_mint = %req.token_mint,
        amount = req.amount,
        recipient = %req.recipient,
        tx_signature = %sig_display,
        "Mint event recorded"
    );

    webhook_dispatch::dispatch(&state.db, "mint", serde_json::to_value(&event).unwrap_or_default());

    Ok(Json(ApiResponse::ok(event)))
}
