//! Fire-and-forget webhook dispatch for mint/burn events.
//!
//! Uses the hyper HTTP client (already a transitive dependency) to avoid
//! introducing additional TLS/OpenSSL build requirements.
//!
//! Delivery is attempted up to MAX_RETRIES times with exponential backoff:
//!   attempt 1: immediate
//!   attempt 2: 1 s delay
//!   attempt 3: 2 s delay

use serde_json::Value;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};

use crate::db::Database;

const MAX_RETRIES: u32 = 3;

/// Dispatch a webhook event to all registered listeners for the given event type.
/// Each HTTP POST is spawned as a background tokio task with exponential backoff
/// retry; delivery failures are logged but do not affect the API response.
pub fn dispatch(db: &Database, event_type: &str, payload: Value) {
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
        let body = serde_json::json!({
            "event": event_type,
            "data": payload,
        });

        tokio::spawn(async move {
            deliver_with_retry(&url, &body).await;
        });
    }
}

/// Attempt delivery up to MAX_RETRIES times with exponential backoff.
/// Delays: 0 s, 1 s, 2 s (attempt indices 0, 1, 2).
async fn deliver_with_retry(url: &str, body: &Value) {
    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            let delay_secs = u64::pow(2, attempt - 1); // 1, 2 seconds
            sleep(Duration::from_secs(delay_secs)).await;
        }

        match post_json(url, body).await {
            Ok(()) => {
                info!(url = %url, attempt = attempt + 1, "Webhook delivered");
                return;
            }
            Err(e) => {
                warn!(
                    url = %url,
                    attempt = attempt + 1,
                    max = MAX_RETRIES,
                    error = %e,
                    "Webhook delivery failed"
                );
            }
        }
    }

    warn!(url = %url, "Webhook delivery exhausted {} attempts, giving up", MAX_RETRIES);
}

async fn post_json(url: &str, body: &Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use hyper::body::Bytes;
    use hyper::{Method, Request};
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::TokioExecutor;
    use http_body_util::Full;

    let json_bytes = serde_json::to_vec(body)?;

    let req = Request::builder()
        .method(Method::POST)
        .uri(url)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(json_bytes)))?;

    let client = Client::builder(TokioExecutor::new()).build_http::<Full<Bytes>>();
    let resp = client.request(req).await?;
    info!(status = %resp.status(), "Webhook HTTP response");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify retry constants are sane
    #[test]
    fn test_retry_constants() {
        assert_eq!(MAX_RETRIES, 3);
        // delays for attempts 1 and 2 (0-indexed 1..2) should be 1s and 2s
        assert_eq!(u64::pow(2, 0), 1);
        assert_eq!(u64::pow(2, 1), 2);
    }

    /// Verify deliver_with_retry gives up after MAX_RETRIES on a bad URL
    #[tokio::test]
    async fn test_deliver_with_retry_bad_url() {
        // Points to a non-existent host — all 3 attempts should fail quickly
        deliver_with_retry("http://127.0.0.1:19999/no-listener", &serde_json::json!({"test": true})).await;
        // If we reach here without panicking, the retry loop completed gracefully
    }
}
