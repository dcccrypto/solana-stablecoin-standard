use axum::{extract::State, Json};
use std::sync::Arc;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, AuditEntry, BlacklistEntry, BlacklistRequest},
};

pub async fn get_blacklist(
    State(db): State<Arc<Database>>,
) -> Result<Json<ApiResponse<Vec<BlacklistEntry>>>, AppError> {
    let entries = db.get_blacklist()?;
    Ok(Json(ApiResponse::ok(entries)))
}

pub async fn add_to_blacklist(
    State(db): State<Arc<Database>>,
    Json(req): Json<BlacklistRequest>,
) -> Result<Json<ApiResponse<BlacklistEntry>>, AppError> {
    if req.address.is_empty() {
        return Err(AppError::BadRequest("address is required".to_string()));
    }
    if req.reason.is_empty() {
        return Err(AppError::BadRequest("reason is required".to_string()));
    }
    let entry = db.add_blacklist(&req.address, &req.reason)?;
    db.add_audit(
        "BLACKLIST_ADD",
        &req.address,
        &format!("Added to blacklist: {}", req.reason),
    )?;
    Ok(Json(ApiResponse::ok(entry)))
}

pub async fn get_audit_log(
    State(db): State<Arc<Database>>,
) -> Result<Json<ApiResponse<Vec<AuditEntry>>>, AppError> {
    let entries = db.get_audit_log()?;
    Ok(Json(ApiResponse::ok(entries)))
}
