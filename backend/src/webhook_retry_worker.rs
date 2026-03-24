//! SSS-145: Background retry worker for failed webhook deliveries.
//!
//! Runs every 60 seconds; picks up delivery log rows with status=pending or
//! status=failed (where next_retry_at <= now), then re-attempts delivery.

use chrono::Utc;
use std::time::Duration;
use tokio::time;
use tracing::{info, warn};

use crate::state::AppState;
use crate::webhook_dispatch::execute_attempt;

/// Start the background retry worker.  Call once after AppState is created.
pub async fn start_retry_worker(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(60));
    // The first tick fires immediately; skip it so we don't retry on startup.
    interval.tick().await;

    loop {
        interval.tick().await;
        run_once(&state).await;
    }
}

/// Execute one retry pass (exported for testing).
pub async fn run_once(state: &AppState) {
    let now = Utc::now().to_rfc3339();
    let deliveries = match state.db.get_pending_webhook_deliveries(&now) {
        Ok(d) => d,
        Err(e) => {
            warn!("retry_worker: failed to fetch pending deliveries: {e}");
            return;
        }
    };

    if deliveries.is_empty() {
        return;
    }

    info!("retry_worker: processing {} pending deliveries", deliveries.len());

    for delivery in deliveries {
        let webhook = match state.db.get_webhook_by_id(&delivery.webhook_id) {
            Ok(Some(wh)) => wh,
            Ok(None) => {
                warn!("retry_worker: webhook {} not found for delivery {}", delivery.webhook_id, delivery.id);
                // Mark permanently failed — webhook deleted
                let _ = state.db.mark_webhook_delivery_failed(
                    &delivery.id,
                    delivery.attempt_count + 1,
                    None,
                );
                continue;
            }
            Err(e) => {
                warn!("retry_worker: db error looking up webhook: {e}");
                continue;
            }
        };

        let body: serde_json::Value = match serde_json::from_str(&delivery.payload) {
            Ok(v) => v,
            Err(e) => {
                warn!("retry_worker: invalid payload json for delivery {}: {e}", delivery.id);
                let _ = state.db.mark_webhook_delivery_failed(&delivery.id, delivery.attempt_count + 1, None);
                continue;
            }
        };

        let attempt = delivery.attempt_count + 1;
        execute_attempt(
            &state.db,
            &delivery.id,
            attempt,
            &webhook.url,
            &body,
            webhook.secret_key.as_deref(),
        )
        .await;
    }
}
