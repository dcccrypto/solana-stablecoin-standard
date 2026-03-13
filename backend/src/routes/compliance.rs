use axum::{extract::State, Json};
use tracing::info;

use crate::{
    error::AppError,
    models::{ApiResponse, AuditEntry, BlacklistEntry, BlacklistRequest},
    state::AppState,
};

pub async fn get_blacklist(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<BlacklistEntry>>>, AppError> {
    let entries = state.db.get_blacklist()?;
    Ok(Json(ApiResponse::ok(entries)))
}

pub async fn add_blacklist(
    State(state): State<AppState>,
    Json(req): Json<BlacklistRequest>,
) -> Result<Json<ApiResponse<BlacklistEntry>>, AppError> {
    if req.address.is_empty() {
        return Err(AppError::BadRequest("address is required".to_string()));
    }
    if req.reason.is_empty() {
        return Err(AppError::BadRequest("reason is required".to_string()));
    }

    let entry = state.db.add_blacklist(&req.address, &req.reason)?;
    state.db.add_audit(
        "BLACKLIST_ADD",
        &req.address,
        &format!("Reason: {}", req.reason),
    )?;

    info!(address = %req.address, reason = %req.reason, "Address blacklisted");

    Ok(Json(ApiResponse::ok(entry)))
}

pub async fn get_audit(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<AuditEntry>>>, AppError> {
    let entries = state.db.get_audit_log()?;
    Ok(Json(ApiResponse::ok(entries)))
}
