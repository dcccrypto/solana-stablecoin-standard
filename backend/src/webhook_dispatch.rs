//! Fire-and-forget webhook dispatch for mint/burn events.
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

use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde_json::Value;
use tracing::{info, warn};
use uuid::Uuid;

use crate::db::Database;

type HmacSha256 = Hmac<Sha256>;

/// Compute HMAC-SHA256 over `message` with `secret` and return lowercase hex.
fn hmac_hex(secret: &[u8], message: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(message);
    hex::encode(mac.finalize().into_bytes())
}

/// Dispatch a webhook event to all registered listeners for the given event type.
/// Each HTTP POST is spawned as a background tokio task; delivery failures are
/// logged but do not affect the API response.
pub fn dispatch(db: &Database, event_type: &str, payload: Value) {
    let webhooks = match db.list_webhooks() {
        Ok(w) => w,
        Err(e) => {
            warn!("webhook_dispatch: failed to list webhooks: {}", e);
            return;
        }
    };

    // Webhook secret for HMAC signing (optional — empty string disables signing).
    let secret = std::env::var("SSS_WEBHOOK_SECRET").unwrap_or_default();

    for wh in webhooks {
        if !wh.events.iter().any(|e| e == event_type || e == "*") {
            continue;
        }

        let url = wh.url.clone();
        // Assign a unique delivery ID and current Unix timestamp.
        let delivery_id = Uuid::new_v4().to_string();
        let delivered_at = chrono::Utc::now().timestamp();

        let body = serde_json::json!({
            "event": event_type,
            "delivery_id": delivery_id,
            "delivered_at": delivered_at,
            "data": payload,
        });

        let secret_clone = secret.clone();

        tokio::spawn(async move {
            if let Err(e) = post_json(&url, &body, &delivery_id, delivered_at, &secret_clone).await {
                warn!(url = %url, error = %e, "Webhook delivery failed");
            } else {
                info!(url = %url, delivery_id = %delivery_id, "Webhook delivered");
            }
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
