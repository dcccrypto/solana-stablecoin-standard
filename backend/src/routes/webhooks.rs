use axum::{
    extract::{Path, State},
    Json,
};
use std::sync::Arc;

use crate::{
    db::Database,
    error::AppError,
    models::{ApiResponse, WebhookEntry, WebhookRequest},
};

pub async fn list_webhooks(
    State(db): State<Arc<Database>>,
) -> Result<Json<ApiResponse<Vec<WebhookEntry>>>, AppError> {
    let webhooks = db.list_webhooks()?;
    Ok(Json(ApiResponse::ok(webhooks)))
}

pub async fn register_webhook(
    State(db): State<Arc<Database>>,
    Json(req): Json<WebhookRequest>,
) -> Result<Json<ApiResponse<WebhookEntry>>, AppError> {
    if req.url.is_empty() {
        return Err(AppError::BadRequest("url is required".to_string()));
    }
    if req.events.is_empty() {
        return Err(AppError::BadRequest("events list must not be empty".to_string()));
    }
    let entry = db.register_webhook(&req.url, &req.events)?;
    Ok(Json(ApiResponse::ok(entry)))
}

pub async fn delete_webhook(
    State(db): State<Arc<Database>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, AppError> {
    let deleted = db.delete_webhook(&id)?;
    if !deleted {
        return Err(AppError::NotFound(format!("Webhook {} not found", id)));
    }
    Ok(Json(ApiResponse::ok(true)))
}
