//! POST /api/burn — record a burn event.
//!
//! **BUG-035 / E-4:** `tx_signature` is verified on-chain via `getTransaction`
//! RPC when provided.  Omitting it skips the RPC call so integration tests and
//! off-chain recording flows continue to work.

use axum::{extract::State, Json};
use tracing::info;

use crate::{
    error::AppError,
    models::{ApiResponse, BurnEvent, BurnRequest},
    routes::onchain,
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

    // BUG-035 / E-4: verify tx_signature on-chain if provided.
    let sig_ref: Option<&str> = req.tx_signature.as_deref();
    if let Some(sig) = sig_ref {
        onchain::verify_tx_signature(sig)
            .await
            .map_err(|e| AppError::BadRequest(format!("tx_signature verification failed: {e}")))?;
    }

    let event = state.db.record_burn(
        &req.token_mint,
        req.amount,
        &req.source,
        sig_ref,
    )?;

    let sig_display = req.tx_signature.as_deref().unwrap_or("none");
    state.db.add_audit(
        "BURN",
        &req.source,
        &format!("Burned {} tokens on mint {} tx={}", req.amount, req.token_mint, sig_display),
    )?;

    info!(
        token_mint = %req.token_mint,
        amount = req.amount,
        source = %req.source,
        tx_signature = %sig_display,
        "Burn event recorded"
    );

    webhook_dispatch::dispatch(&state.db, "burn", serde_json::to_value(&event).unwrap_or_default());

    Ok(Json(ApiResponse::ok(event)))
}
