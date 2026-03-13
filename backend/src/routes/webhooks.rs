use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use tracing::info;

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
        return Err(AppError::BadRequest("events list cannot be empty".to_string()));
    }

    let entry = db.register_webhook(&req.url, &req.events)?;
    info!(url = %req.url, events = ?req.events, "Webhook registered");

    Ok(Json(ApiResponse::ok(entry)))
}

pub async fn delete_webhook(
    State(db): State<Arc<Database>>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<ApiResponse<serde_json::Value>>), AppError> {
    let deleted = db.delete_webhook(&id)?;
    if deleted {
        info!(id = %id, "Webhook deleted");
        Ok((
            StatusCode::OK,
            Json(ApiResponse::ok(serde_json::json!({ "deleted": true, "id": id }))),
        ))
    } else {
        Err(AppError::NotFound(format!("Webhook {} not found", id)))
    }
}
