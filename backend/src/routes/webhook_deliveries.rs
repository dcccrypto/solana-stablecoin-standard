//! SSS-145: GET /api/webhook-deliveries — operator view of failed deliveries.

use axum::{extract::State, Json};
use axum::extract::Query;

use crate::{
    error::AppError,
    models::{ApiResponse, WebhookDeliveryLog, WebhookDeliveriesQuery},
    state::AppState,
};

pub async fn list_webhook_deliveries(
    State(state): State<AppState>,
    Query(q): Query<WebhookDeliveriesQuery>,
) -> Result<Json<ApiResponse<Vec<WebhookDeliveryLog>>>, AppError> {
    // For now only ?status=failed is supported (returns permanently_failed rows).
    // When status is omitted or anything else, same behaviour for safety.
    let _ = q.status; // future extension — could filter pending/delivered too
    let entries = state.db.list_failed_webhook_deliveries()?;
    Ok(Json(ApiResponse::ok(entries)))
}
