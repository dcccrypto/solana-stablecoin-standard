//! Fire-and-forget webhook dispatch for mint/burn events.
//!
//! Uses the hyper HTTP client (already a transitive dependency) to avoid
//! introducing additional TLS/OpenSSL build requirements.

use serde_json::Value;
use tracing::{info, warn};

use crate::db::Database;

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
        let body = serde_json::json!({
            "event": event_type,
            "data": payload,
        });

        tokio::spawn(async move {
            if let Err(e) = post_json(&url, &body).await {
                warn!(url = %url, error = %e, "Webhook delivery failed");
            } else {
                info!(url = %url, "Webhook delivered");
            }
        });
    }
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
