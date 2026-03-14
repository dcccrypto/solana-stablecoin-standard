use axum::{
    extract::{Path, Query, State},
    Json,
};
use tracing::info;

use crate::{
    error::AppError,
    models::{ApiResponse, AuditPageResponse, AuditQuery, BlacklistEntry, BlacklistRequest, PageMeta},
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

pub async fn remove_blacklist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let removed = state.db.remove_blacklist(&id)?;
    if removed {
        info!(id = %id, "Address removed from blacklist");
        Ok(Json(ApiResponse::ok(serde_json::json!({ "removed": true, "id": id }))))
    } else {
        Err(AppError::NotFound(format!("Blacklist entry {} not found", id)))
    }
}

/// `GET /api/compliance/audit`
///
/// Query parameters:
/// - `address` — filter by wallet/contract address (optional)
/// - `action`  — filter by action type, e.g. `BLACKLIST_ADD` (optional)
/// - `limit`   — page size, default 50, max 1000
/// - `offset`  — zero-based record offset, default 0
///
/// Response includes a `page` metadata object with `total`, `offset`, and `limit`.
pub async fn get_audit(
    State(state): State<AppState>,
    Query(query): Query<AuditQuery>,
) -> Result<Json<ApiResponse<AuditPageResponse>>, AppError> {
    let limit = query.limit.unwrap_or(50).min(1000);
    let offset = query.offset.unwrap_or(0);

    let total = state.db.count_audit_log(query.address.as_deref(), query.action.as_deref())?;
    let entries = state.db.get_audit_log(
        query.address.as_deref(),
        query.action.as_deref(),
        limit,
        offset,
    )?;
    Ok(Json(ApiResponse::ok(AuditPageResponse {
        entries,
        page: PageMeta { total, offset, limit },
    })))
}
