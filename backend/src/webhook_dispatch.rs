//! Fire-and-forget webhook dispatcher for SSS events.
//!
//! SSS-142: Extended to support HMAC-SHA256 signed deliveries.
//! When a webhook has a `secret_key`, each POST includes:
//!   `X-SSS-Signature: sha256=<hex>`
//! Subscribers verify the signature against the raw JSON body.

use serde_json::Value;
use tracing::{info, warn};

use crate::db::Database;
use crate::indexer_schema::hmac_sha256_hex;

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

    for wh in webhooks {
        if !wh.events.iter().any(|e| e == event_type || e == "*") {
            continue;
        }

        let url = wh.url.clone();
        let secret = wh.secret_key.clone();
        let body = serde_json::json!({
            "event": event_type,
            "data": payload,
        });

        tokio::spawn(async move {
            if let Err(e) = post_json(&url, &body, secret.as_deref()).await {
                warn!(url = %url, error = %e, "Webhook delivery failed");
            } else {
                info!(url = %url, "Webhook delivered");
            }
        });
    }
}

async fn post_json(
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

    // SSS-142: Add HMAC signature header if secret is configured.
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
