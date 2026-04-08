//! SSS-105: WebSocket endpoint for real-time liquidation + CDP event streaming.
//!
//! Endpoint: `GET /api/ws/events?type=<filter>`
//!
//! Clients connect via WebSocket and receive a stream of JSON event objects
//! whenever the on-chain indexer detects a matching event.
//!
//! # Query params
//! - `type` — comma-separated list of event types to subscribe to.
//!   Accepted values: `liquidation`, `cdp`, `circuit-breaker`, or omit for all.
//!   Aliases:
//!   - `liquidation` → matches `cdp_liquidate`
//!   - `cdp`         → matches `cdp_deposit`, `cdp_borrow`, `cdp_liquidate`
//!   - `circuit-breaker` → matches `circuit_breaker_toggle`
//!
//! # Event JSON shape
//! ```json
//! {
//!   "event_type": "cdp_liquidate",
//!   "address": "PosABC...",
//!   "data": { ... },
//!   "signature": "5xyz...",
//!   "slot": 123456
//! }
//! ```

use axum::{
    extract::{Query, State, WebSocketUpgrade},
    response::IntoResponse,
};
use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::state::AppState;

/// Query parameters for the WS events endpoint.
#[derive(Debug, Deserialize)]
pub struct WsEventsQuery {
    /// Comma-separated filter: `liquidation`, `cdp`, `circuit-breaker`
    #[serde(rename = "type")]
    pub event_type: Option<String>,
}

/// Expand a comma-separated filter string into canonical `event_type` patterns.
/// Returns `None` if no filter is specified (= subscribe to all events).
fn expand_filter(raw: Option<&str>) -> Option<Vec<String>> {
    let raw = raw?;
    if raw.trim().is_empty() {
        return None;
    }
    let mut types: Vec<String> = Vec::new();
    for part in raw.split(',') {
        match part.trim() {
            "liquidation" => {
                let s = "cdp_liquidate".to_string();
                if !types.contains(&s) {
                    types.push(s);
                }
            }
            "cdp" => {
                for t in &["cdp_deposit", "cdp_borrow", "cdp_liquidate"] {
                    let s = t.to_string();
                    if !types.contains(&s) {
                        types.push(s);
                    }
                }
            }
            "circuit-breaker" => {
                let s = "circuit_breaker_toggle".to_string();
                if !types.contains(&s) {
                    types.push(s);
                }
            }
            other => {
                // Pass-through for raw event_type strings (e.g. "oracle_params_update")
                let s = other.to_string();
                if !types.contains(&s) {
                    types.push(s);
                }
            }
        }
    }
    if types.is_empty() {
        None
    } else {
        Some(types)
    }
}

/// Returns true if the event matches the active filter.
fn event_matches(event: &serde_json::Value, filter: &Option<Vec<String>>) -> bool {
    match filter {
        None => true, // no filter → all events
        Some(types) => {
            let et = event
                .get("event_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            types.iter().any(|t| t == et)
        }
    }
}

/// Upgrade handler — called by Axum when a client connects.
pub async fn ws_events_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<WsEventsQuery>,
) -> impl IntoResponse {
    let filter = expand_filter(query.event_type.as_deref());
    let rx = state.ws_tx.subscribe();
    ws.on_upgrade(move |socket| handle_socket(socket, rx, filter))
}

/// Drive a single WebSocket connection.
async fn handle_socket(
    socket: WebSocket,
    mut rx: broadcast::Receiver<serde_json::Value>,
    filter: Option<Vec<String>>,
) {
    let (mut sender, mut receiver) = socket.split();

    // Send a welcome / subscription-confirmed message.
    let welcome = serde_json::json!({
        "type": "subscribed",
        "filter": filter.as_deref().map(|f| f.join(",")),
        "message": "Connected to SSS event stream",
    });
    if sender
        .send(Message::Text(welcome.to_string()))
        .await
        .is_err()
    {
        return; // client gone before we could greet them
    }
    info!("ws_events: client connected, filter={:?}", filter);

    loop {
        tokio::select! {
            // Forward broadcast events to the WS client.
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        if event_matches(&event, &filter) {
                            let msg = event.to_string();
                            if sender.send(Message::Text(msg)).await.is_err() {
                                debug!("ws_events: client disconnected");
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("ws_events: receiver lagged by {n} events");
                        // Notify client of lag, then continue.
                        let lag_msg = serde_json::json!({
                            "type": "lag",
                            "missed": n,
                        });
                        if sender.send(Message::Text(lag_msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("ws_events: broadcast channel closed");
                        break;
                    }
                }
            }
            // Handle incoming messages from the client (ping/pong / close).
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        debug!("ws_events: client sent close frame");
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if sender.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    _ => {} // ignore text/binary from client
                }
            }
        }
    }

    info!("ws_events: connection closed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_filter_none() {
        assert!(expand_filter(None).is_none());
        assert!(expand_filter(Some("")).is_none());
    }

    #[test]
    fn test_expand_filter_liquidation() {
        let f = expand_filter(Some("liquidation")).unwrap();
        assert_eq!(f, vec!["cdp_liquidate".to_string()]);
    }

    #[test]
    fn test_expand_filter_cdp() {
        let f = expand_filter(Some("cdp")).unwrap();
        assert!(f.contains(&"cdp_deposit".to_string()));
        assert!(f.contains(&"cdp_borrow".to_string()));
        assert!(f.contains(&"cdp_liquidate".to_string()));
    }

    #[test]
    fn test_expand_filter_circuit_breaker() {
        let f = expand_filter(Some("circuit-breaker")).unwrap();
        assert_eq!(f, vec!["circuit_breaker_toggle".to_string()]);
    }

    #[test]
    fn test_expand_filter_combined() {
        let f = expand_filter(Some("liquidation,circuit-breaker")).unwrap();
        assert!(f.contains(&"cdp_liquidate".to_string()));
        assert!(f.contains(&"circuit_breaker_toggle".to_string()));
    }

    #[test]
    fn test_event_matches_no_filter() {
        let event = serde_json::json!({ "event_type": "cdp_liquidate" });
        assert!(event_matches(&event, &None));
    }

    #[test]
    fn test_event_matches_with_filter_pass() {
        let event = serde_json::json!({ "event_type": "cdp_liquidate" });
        let filter = Some(vec!["cdp_liquidate".to_string(), "circuit_breaker_toggle".to_string()]);
        assert!(event_matches(&event, &filter));
    }

    #[test]
    fn test_event_matches_with_filter_reject() {
        let event = serde_json::json!({ "event_type": "oracle_params_update" });
        let filter = Some(vec!["cdp_liquidate".to_string()]);
        assert!(!event_matches(&event, &filter));
    }

    #[test]
    fn test_broadcast_send_recv() {
        use tokio::runtime::Runtime;
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let (tx, mut rx) = broadcast::channel::<serde_json::Value>(8);
            let event = serde_json::json!({ "event_type": "cdp_liquidate", "address": "ABC" });
            tx.send(event.clone()).unwrap();
            let received = rx.recv().await.unwrap();
            assert_eq!(received["event_type"], "cdp_liquidate");
        });
    }

    #[test]
    fn test_broadcast_filter_drops_non_matching() {
        use tokio::runtime::Runtime;
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let (tx, mut rx) = broadcast::channel::<serde_json::Value>(8);
            let liq = serde_json::json!({ "event_type": "cdp_liquidate" });
            let oracle = serde_json::json!({ "event_type": "oracle_params_update" });
            tx.send(oracle).unwrap();
            tx.send(liq.clone()).unwrap();

            let filter = Some(vec!["cdp_liquidate".to_string()]);
            // Drain both; only liq should pass filter
            let mut passed = vec![];
            for _ in 0..2 {
                if let Ok(ev) = rx.recv().await {
                    if event_matches(&ev, &filter) {
                        passed.push(ev);
                    }
                }
            }
            assert_eq!(passed.len(), 1);
            assert_eq!(passed[0]["event_type"], "cdp_liquidate");
        });
    }

    #[test]
    fn test_broadcast_lag_detection() {
        use tokio::runtime::Runtime;
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            // Tiny channel so we can force lag
            let (tx, mut rx) = broadcast::channel::<serde_json::Value>(2);
            for i in 0..5u64 {
                let _ = tx.send(serde_json::json!({ "i": i }));
            }
            // Receiver should get Lagged error
            let result = rx.recv().await;
            assert!(
                matches!(result, Err(broadcast::error::RecvError::Lagged(_))),
                "expected Lagged error, got {:?}",
                result
            );
        });
    }
}
