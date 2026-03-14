use std::sync::Arc;

use crate::db::Database;
use crate::metrics::MetricsState;
use crate::rate_limit::RateLimiter;

/// Shared application state threaded through Axum's router.
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub rate_limiter: Arc<RateLimiter>,
    pub metrics: MetricsState,
}

impl AppState {
    pub fn new(db: Database) -> Self {
        Self {
            db: Arc::new(db),
            rate_limiter: Arc::new(RateLimiter::from_env()),
            metrics: MetricsState::new(),
        }
    }

    /// Constructor used in tests — accepts a custom RateLimiter so tests can
    /// configure capacity/refill independently of the production default.
    #[cfg(test)]
    pub fn with_limiter(db: Database, rate_limiter: RateLimiter) -> Self {
        Self {
            db: Arc::new(db),
            rate_limiter: Arc::new(rate_limiter),
            metrics: MetricsState::new(),
        }
    }
}
