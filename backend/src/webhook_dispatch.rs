//! Webhook dispatcher for SSS events — SSS-142 (HMAC signing) + SSS-145 (retry log).
//!
//! Each call to `dispatch()` writes a `webhook_delivery_log` row (status=pending)
//! then spawns a background task for the initial delivery attempt.
//!
//! Backoff schedule (1-indexed attempt):
//!   attempt 1 fails → next_retry_at = now + 1s  (status=failed)
//!   attempt 2 fails → next_retry_at = now + 5s  (status=failed)
//!   attempt 3 fails → permanently_failed + emit MetricsAlert
//!
//! The retry worker (`webhook_retry_worker`) handles subsequent attempts.

use chrono::{Duration, Utc};
use serde_json::Value;
use std::sync::Arc;
use tracing::{info, warn};

use crate::db::Database;
use crate::indexer_schema::hmac_sha256_hex;

/// Backoff delay in seconds for attempt n (0-based index = attempt - 1).
const BACKOFF_SECS: [i64; 2] = [1, 5];
/// Maximum delivery attempts before permanently failing.
const MAX_ATTEMPTS: i64 = 3;

/// Compute the next_retry_at timestamp for a given attempt count (1-based).
/// Returns None if attempt >= MAX_ATTEMPTS (no more retries).
pub fn next_retry_after(attempt: i64) -> Option<String> {
    if attempt >= MAX_ATTEMPTS {
        return None;
    }
    let idx = (attempt - 1) as usize;
    let secs = BACKOFF_SECS.get(idx).copied().unwrap_or(30);
    Some((Utc::now() + Duration::seconds(secs)).to_rfc3339())
}

/// Execute one delivery attempt for the given delivery log row.
/// Claims the row as 'in-progress' BEFORE the HTTP POST to prevent race conditions,
/// then updates to 'delivered' / 'failed' / 'permanently_failed' after.
pub async fn execute_attempt(
    db: &Arc<Database>,
    delivery_id: &str,
    attempt: i64,
    url: &str,
    body: &Value,
    secret: Option<&str>,
) {
    // Claim the row atomically before HTTP POST (race-free via DB constraint).
    match db.claim_webhook_delivery(delivery_id) {
        Ok(false) => {
            // Row already claimed by another worker — skip.
            warn!("Delivery {delivery_id} already in-progress, skipping duplicate attempt");
            return;
        }
        Err(e) => {
            warn!("Failed to claim delivery {delivery_id}: {e}");
            return;
        }
        Ok(true) => {}
    }

    // Now perform the HTTP POST.
    match post_json(url, body, secret).await {
        Ok(()) => {
            info!(url = %url, delivery_id = %delivery_id, "Webhook delivered");
            if let Err(e) = db.mark_webhook_delivery_delivered(delivery_id) {
                warn!("Failed to mark delivery {delivery_id} delivered: {e}");
            }
        }
        Err(e) => {
            warn!(url = %url, attempt = attempt, error = %e, "Webhook delivery failed");
            let next_retry = next_retry_after(attempt);
            if next_retry.is_none() {
                // Permanently fail and emit alert
                if let Err(e2) = db.mark_webhook_delivery_failed(delivery_id, attempt, None) {
                    warn!("Failed to mark delivery {delivery_id} permanently_failed: {e2}");
                }
                let _ = db.insert_event_log(
                    "MetricsAlert",
                    "webhook_retry",
                    serde_json::json!({
                        "delivery_id": delivery_id,
                        "reason": "max_retries_exceeded",
                        "url": url,
                    }),
                    None,
                    None,
                );
            } else {
                if let Err(e2) = db.mark_webhook_delivery_failed(
                    delivery_id,
                    attempt,
                    next_retry.as_deref(),
                ) {
                    warn!("Failed to mark delivery {delivery_id} failed: {e2}");
                }
            }
        }
    }
}

/// Dispatch a webhook event to all registered listeners for the given event type.
/// Accepts `&Arc<Database>` to allow async tasks to hold a clone.
pub fn dispatch(db: &Arc<Database>, event_type: &str, payload: Value) {
    let webhooks = match db.list_webhooks() {
        Ok(w) => w,
        Err(e) => {
            warn!("webhook_dispatch: failed to list webhooks: {}", e);
            return;
        }
    };

    for wh in webhooks {
        if !wh.events.iter().any(|e| e == event_type || e == "*") {
            continue;
        }

        let body = serde_json::json!({
            "event": event_type,
            "data": payload,
        });
        let payload_str = body.to_string();

        let delivery_id = match db.insert_webhook_delivery(&wh.id, event_type, &payload_str) {
            Ok(id) => id,
            Err(e) => {
                warn!("webhook_dispatch: failed to log delivery for {}: {}", wh.id, e);
                continue;
            }
        };

        let db_clone = Arc::clone(db);
        let url = wh.url.clone();
        let secret = wh.hashed_secret.clone();

        tokio::spawn(async move {
            execute_attempt(&db_clone, &delivery_id, 1, &url, &body, secret.as_deref()).await;
        });
    }
}

pub async fn post_json(
    url: &str,
    body: &Value,
    secret: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use hyper::body::Bytes;
    use hyper::{Method, Request};
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::TokioExecutor;
    use http_body_util::Full;

    let json_bytes = serde_json::to_vec(body)?;
    let json_str = std::str::from_utf8(&json_bytes)?;

    let mut req_builder = Request::builder()
        .method(Method::POST)
        .uri(url)
        .header("content-type", "application/json");

    if let Some(sec) = secret {
        let sig = hmac_sha256_hex(sec, json_str);
        req_builder = req_builder.header("X-SSS-Signature", format!("sha256={}", sig));
    }

    let req = req_builder.body(Full::new(Bytes::from(json_bytes)))?;
    let client = Client::builder(TokioExecutor::new()).build_http::<Full<Bytes>>();
    let resp = client.request(req).await?;
    info!(status = %resp.status(), "Webhook HTTP response");
    Ok(())
}
