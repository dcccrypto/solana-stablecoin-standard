#![allow(dead_code)]
//! Webhook dispatcher for SSS events — SSS-142 (HMAC signing) + SSS-145 (retry log).
//!
//! ## Replay-Attack Prevention (SSS-BUG-025)
//!
//! Each delivery is assigned a unique `delivery_id` (UUID v4) and a
//! `delivered_at` Unix timestamp (seconds).  Both values are included in
//! the signed payload so that an attacker who captures a valid delivery
//! cannot replay it:
//!
//! ```
//! signed_string = "<delivery_id>.<delivered_at>.<json_body>"
//! X-SSS-Signature: sha256=<hex(HMAC-SHA256(secret, signed_string))>
//! X-SSS-Delivery:  <delivery_id>
//! X-SSS-Timestamp: <delivered_at>
//! ```
//!
//! **Receiver guidance**: reject any webhook where `delivered_at` is more
//! than 300 seconds (5 minutes) in the past, and deduplicate on
//! `X-SSS-Delivery` to prevent replay.
//!
//! The HMAC secret is read from the `SSS_WEBHOOK_SECRET` environment
//! variable.  If the variable is absent or empty, delivery proceeds
//! *without* a signature header (backwards-compatible for local dev).

use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde_json::Value;
use std::sync::Arc;
use tracing::{info, warn};

use crate::db::Database;
#[allow(unused_imports)]
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
    let delivered_at = Utc::now().timestamp();
    match post_json(url, body, delivery_id, delivered_at, secret.unwrap_or("")).await {
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
            } else if let Err(e2) = db.mark_webhook_delivery_failed(
                delivery_id,
                attempt,
                next_retry.as_deref(),
            ) {
                warn!("Failed to mark delivery {delivery_id} failed: {e2}");
            }
        }
    }
}

type HmacSha256 = Hmac<Sha256>;

/// Compute HMAC-SHA256 over `message` with `secret` and return lowercase hex.
fn hmac_hex(secret: &[u8], message: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(message);
    hex::encode(mac.finalize().into_bytes())
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

        let url = wh.url.clone();
        // Assign a unique delivery ID and current Unix timestamp.
        let delivered_at = chrono::Utc::now().timestamp();

        let body = serde_json::json!({
            "event": event_type,
            "delivered_at": delivered_at,
            "data": payload,
        });

        // Insert a delivery log row so execute_attempt can claim it.
        let payload_str = body.to_string();
        let delivery_id = match db.insert_webhook_delivery(&wh.id, event_type, &payload_str) {
            Ok(id) => id,
            Err(e) => {
                warn!("webhook_dispatch: failed to insert delivery log for {}: {}", wh.url, e);
                continue;
            }
        };

        // Include delivery_id in the body sent to the receiver.
        let body = serde_json::json!({
            "event": event_type,
            "delivery_id": delivery_id,
            "delivered_at": delivered_at,
            "data": payload,
        });

        let db_clone = Arc::clone(db);
        let secret = wh.hashed_secret.clone();

        tokio::spawn(async move {
            execute_attempt(&db_clone, &delivery_id, 1, &url, &body, secret.as_deref()).await;
        });
    }
}

async fn post_json(
    url: &str,
    body: &Value,
    delivery_id: &str,
    delivered_at: i64,
    secret: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use hyper::body::Bytes;
    use hyper::{Method, Request};
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::TokioExecutor;
    use http_body_util::Full;

    let json_bytes = serde_json::to_vec(body)?;
    let _json_str = std::str::from_utf8(&json_bytes)?;

    let mut builder = Request::builder()
        .method(Method::POST)
        .uri(url)
        .header("content-type", "application/json")
        .header("x-sss-delivery", delivery_id)
        .header("x-sss-timestamp", delivered_at.to_string());

    // SSS-BUG-025: include delivery_id + timestamp in the HMAC input so the
    // signed string is unique per delivery and time-bound.
    if !secret.is_empty() {
        let signed_string = format!("{}.{}.{}", delivery_id, delivered_at, String::from_utf8_lossy(&json_bytes));
        let sig = hmac_hex(secret.as_bytes(), signed_string.as_bytes());
        builder = builder.header("x-sss-signature", format!("sha256={}", sig));
    }

    let req = builder.body(Full::new(Bytes::from(json_bytes)))?;
    let client = Client::builder(TokioExecutor::new()).build_http::<Full<Bytes>>();
    let resp = client.request(req).await?;
    info!(status = %resp.status(), "Webhook HTTP response");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac_deterministic() {
        let sig1 = hmac_hex(b"secret", b"msg");
        let sig2 = hmac_hex(b"secret", b"msg");
        assert_eq!(sig1, sig2);
    }

    #[test]
    fn test_hmac_differs_on_different_delivery_id() {
        // Two deliveries with different IDs must produce different signatures
        // even if the payload is identical — prevents replay.
        let payload = b"{}";
        let ts: i64 = 1000000;
        let id1 = "uuid-aaa";
        let id2 = "uuid-bbb";
        let msg1 = format!("{}.{}.{}", id1, ts, String::from_utf8_lossy(payload));
        let msg2 = format!("{}.{}.{}", id2, ts, String::from_utf8_lossy(payload));
        assert_ne!(
            hmac_hex(b"secret", msg1.as_bytes()),
            hmac_hex(b"secret", msg2.as_bytes())
        );
    }

    #[test]
    fn test_hmac_differs_on_different_timestamp() {
        // Replaying the same delivery_id at a different time must fail verification.
        let payload = b"{}";
        let id = "uuid-aaa";
        let msg1 = format!("{}.{}.{}", id, 1000000, String::from_utf8_lossy(payload));
        let msg2 = format!("{}.{}.{}", id, 1000300, String::from_utf8_lossy(payload));
        assert_ne!(
            hmac_hex(b"secret", msg1.as_bytes()),
            hmac_hex(b"secret", msg2.as_bytes())
        );
    }
}
