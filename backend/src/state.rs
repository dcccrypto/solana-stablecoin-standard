use std::sync::Arc;

use tokio::sync::broadcast;

use crate::db::Database;
use crate::rate_limit::RateLimiter;

/// Capacity of the WS broadcast channel (number of buffered events).
/// Slow clients that fall too far behind will receive a lag error on reconnect.
pub const WS_BROADCAST_CAPACITY: usize = 256;

/// Shared application state threaded through Axum's router.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub rate_limiter: Arc<RateLimiter>,
    /// Broadcast channel for real-time WebSocket event dispatch (SSS-105).
    /// The sender is stored in AppState; each WS handler receives a clone of
    /// the `Receiver` via `tx.subscribe()`.
    pub ws_tx: broadcast::Sender<serde_json::Value>,
}

impl AppState {
    pub fn new(db: Database) -> Self {
        let (ws_tx, _) = broadcast::channel(WS_BROADCAST_CAPACITY);
        Self {
            db: Arc::new(db),
            rate_limiter: Arc::new(RateLimiter::from_env()),
            ws_tx,
        }
    }

    /// Constructor used in tests — accepts a custom RateLimiter so tests can
    /// configure capacity/refill independently of the production default.
    #[cfg(test)]
    pub fn with_limiter(db: Database, rate_limiter: RateLimiter) -> Self {
        let (ws_tx, _) = broadcast::channel(WS_BROADCAST_CAPACITY);
        Self {
            db: Arc::new(db),
            rate_limiter: Arc::new(rate_limiter),
            ws_tx,
        }
    }
}
