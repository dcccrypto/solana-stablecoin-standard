use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};

use crate::models::ApiResponse;
use crate::state::AppState;

pub async fn create_api_key(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let label = body
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("unnamed")
        .to_string();

    match state.db.create_api_key(&label) {
        Ok(entry) => Ok(Json(ApiResponse::ok(serde_json::json!({
            "id": entry.id,
            "key": entry.key,
            "label": entry.label,
            "created_at": entry.created_at
        })))),
        Err(e) => {
            tracing::error!("Failed to create API key: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_api_keys(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    match state.db.list_api_keys() {
        Ok(keys) => {
            let redacted: Vec<serde_json::Value> = keys
                .into_iter()
                .map(|k| {
                    serde_json::json!({
                        "id": k.id,
                        "label": k.label,
                        "key_prefix": &k.key[..8],
                        "created_at": k.created_at
                    })
                })
                .collect();
            Ok(Json(ApiResponse::ok(serde_json::json!({ "api_keys": redacted }))))
        }
        Err(e) => {
            tracing::error!("Failed to list API keys: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_api_key(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    match state.db.delete_api_key(&id) {
        Ok(true) => Ok(Json(ApiResponse::ok(serde_json::json!({ "deleted": true })))),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to delete API key: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
