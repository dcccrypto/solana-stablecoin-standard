//! Async webhook dispatcher — fires HTTP POST to registered subscriber URLs.
//!
//! Dispatch is best-effort: errors are logged but never propagate to the caller.
//! Each delivery is made with a 5-second timeout.  All deliveries for a single
//! event are launched concurrently via `tokio::spawn`.

use serde::Serialize;
use tracing::{error, info, warn};

/// Envelope sent to every subscriber URL.
#[derive(Serialize)]
pub struct WebhookPayload<T: Serialize> {
    /// Event kind: "mint" | "burn"
    pub event: String,
    /// Event-specific data.
    pub data: T,
    /// RFC-3339 timestamp of when the delivery was triggered.
    pub delivered_at: String,
}

/// Dispatch `data` to all `urls` as a JSON POST.
///
/// This function is **fire-and-forget** — it spawns a Tokio task per URL and
/// returns immediately.  Use `await dispatch(...)` to wait for all tasks to be
/// *spawned* (not finished).
pub async fn dispatch<T>(event: &str, data: T, urls: Vec<String>)
where
    T: Serialize + Send + Clone + 'static,
{
    if urls.is_empty() {
        return;
    }

    let delivered_at = chrono::Utc::now().to_rfc3339();

    for url in urls {
        let event = event.to_string();
        let data = data.clone();
        let delivered_at = delivered_at.clone();

        tokio::spawn(async move {
            let payload = WebhookPayload {
                event: event.clone(),
                data,
                delivered_at,
            };

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build();

            let client = match client {
                Ok(c) => c,
                Err(e) => {
                    error!(url = %url, error = %e, "Failed to build reqwest client");
                    return;
                }
            };

            match client.post(&url).json(&payload).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        info!(url = %url, event = %event, status = %status, "Webhook delivered");
                    } else {
                        warn!(url = %url, event = %event, status = %status, "Webhook returned non-2xx");
                    }
                }
                Err(e) => {
                    error!(url = %url, event = %event, error = %e, "Webhook delivery failed");
                }
            }
        });
    }
}
