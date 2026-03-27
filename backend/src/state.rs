use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::broadcast;

use crate::db::Database;
use crate::rate_limit::RateLimiter;

/// Capacity of the WS broadcast channel (number of buffered events).
/// Slow clients that fall too far behind will receive a lag error on reconnect.
pub const WS_BROADCAST_CAPACITY: usize = 256;

/// Atomically-updated cache of the on-chain `StablecoinConfig.feature_flags`
/// bitmask. Updated by the background `flag_refresh` worker; read by API
/// handlers to gate flag-guarded endpoints.
pub struct FeatureFlagsCache {
    flags: AtomicU64,
}

impl FeatureFlagsCache {
    pub fn new() -> Self {
        Self {
            flags: AtomicU64::new(0),
        }
    }

    /// Return the current cached flag bitmask.
    pub fn get(&self) -> u64 {
        self.flags.load(Ordering::Relaxed)
    }

    /// Overwrite the cached flag bitmask (called by the refresh worker).
    pub fn set(&self, v: u64) {
        self.flags.store(v, Ordering::Relaxed);
    }

    /// Returns `true` if the given flag bit (or combination) is set.
    pub fn is_set(&self, flag: u64) -> bool {
        self.get() & flag != 0
    }
}

impl Default for FeatureFlagsCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared application state threaded through Axum's router.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub rate_limiter: Arc<RateLimiter>,
    /// Broadcast channel for real-time WebSocket event dispatch (SSS-105).
    /// The sender is stored in AppState; each WS handler receives a clone of
    /// the `Receiver` via `tx.subscribe()`.
    pub ws_tx: broadcast::Sender<serde_json::Value>,
    /// SSS-AUDIT2-C: Cached on-chain feature_flags bitmask.
    /// Updated every 30 s by the flag_refresh background worker.
    /// All handlers that gate on feature flags read from here.
    pub feature_flags: Arc<FeatureFlagsCache>,
}

impl AppState {
    pub fn new(db: Database) -> Self {
        let (ws_tx, _) = broadcast::channel(WS_BROADCAST_CAPACITY);
        Self {
            db: Arc::new(db),
            rate_limiter: Arc::new(RateLimiter::from_env()),
            ws_tx,
            feature_flags: Arc::new(FeatureFlagsCache::new()),
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
            feature_flags: Arc::new(FeatureFlagsCache::new()),
        }
    }
}
