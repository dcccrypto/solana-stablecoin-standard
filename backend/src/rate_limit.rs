//! Token-bucket rate limiter keyed by API key string.
//!
//! Each API key gets a bucket of `capacity` tokens.
//! Tokens refill at `refill_per_second` tokens/sec (continuous approximation).
//! On each request, one token is consumed. If the bucket is empty the request
//! is rejected with 429.
//!
//! The implementation is entirely in-memory and resets on process restart,
//! which is appropriate for a single-instance deployment.
//!
//! ## Configuration (SSS-010)
//!
//! Two environment variables control the limiter at startup:
//!
//! | Variable                  | Default | Description                          |
//! |---------------------------|---------|--------------------------------------|
//! | `RATE_LIMIT_CAPACITY`     | `60`    | Burst size (max tokens per bucket)   |
//! | `RATE_LIMIT_RPS`          | `1.0`   | Refill rate (tokens added per second)|
//!
//! Invalid or missing values silently fall back to the defaults.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::Instant,
};

/// Per-key state stored inside the bucket map.
struct BucketState {
    /// Current token count (fractional, but capped at `capacity`).
    tokens: f64,
    /// Last time this bucket was topped-up.
    last_refill: Instant,
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<String, BucketState>>,
    /// Maximum tokens a bucket can hold (also the initial fill level).
    capacity: f64,
    /// Tokens added per second.
    refill_per_second: f64,
}

impl RateLimiter {
    /// Create a new limiter.
    ///
    /// * `capacity`          — burst limit (max tokens in bucket)
    /// * `refill_per_second` — steady-state request rate allowed
    pub fn new(capacity: u32, refill_per_second: f64) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            capacity: capacity as f64,
            refill_per_second,
        }
    }

    /// Attempt to consume one token for `key`.
    ///
    /// Returns `true` if the request is allowed, `false` if rate-limited.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.buckets.lock().expect("rate limiter lock poisoned");

        let entry = map.entry(key.to_string()).or_insert_with(|| BucketState {
            tokens: self.capacity,
            last_refill: now,
        });

        // Refill tokens based on elapsed time.
        let elapsed = now.duration_since(entry.last_refill).as_secs_f64();
        entry.tokens = (entry.tokens + elapsed * self.refill_per_second).min(self.capacity);
        entry.last_refill = now;

        if entry.tokens >= 1.0 {
            entry.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Default limiter: 60 req/min burst, ~1 req/sec steady state.
impl Default for RateLimiter {
    fn default() -> Self {
        // 60 token burst, refills at 1 token/second (= 60 req/min sustained)
        Self::new(60, 1.0)
    }
}

impl RateLimiter {
    /// Construct a limiter from environment variables.
    ///
    /// Reads:
    /// - `RATE_LIMIT_CAPACITY` — burst size (positive integer, default 60)
    /// - `RATE_LIMIT_RPS`      — tokens added per second (positive float, default 1.0)
    ///
    /// Invalid or missing values fall back to defaults with a warning log.
    pub fn from_env() -> Self {
        const DEFAULT_CAPACITY: u32 = 60;
        const DEFAULT_RPS: f64 = 1.0;

        let capacity = std::env::var("RATE_LIMIT_CAPACITY")
            .ok()
            .and_then(|v| {
                v.parse::<u32>().ok().filter(|&n| n > 0).or_else(|| {
                    tracing::warn!(
                        "RATE_LIMIT_CAPACITY='{}' is invalid; using default {}",
                        v,
                        DEFAULT_CAPACITY
                    );
                    None
                })
            })
            .unwrap_or(DEFAULT_CAPACITY);

        let rps = std::env::var("RATE_LIMIT_RPS")
            .ok()
            .and_then(|v| {
                v.parse::<f64>().ok().filter(|&n| n > 0.0).or_else(|| {
                    tracing::warn!(
                        "RATE_LIMIT_RPS='{}' is invalid; using default {}",
                        v,
                        DEFAULT_RPS
                    );
                    None
                })
            })
            .unwrap_or(DEFAULT_RPS);

        tracing::info!(
            "Rate limiter configured: capacity={} tokens, refill={} tokens/sec",
            capacity,
            rps
        );

        Self::new(capacity, rps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_allows_up_to_capacity() {
        let rl = RateLimiter::new(5, 0.0); // no refill
        for _ in 0..5 {
            assert!(rl.check("key1"));
        }
        assert!(!rl.check("key1"));
    }

    #[test]
    fn test_different_keys_are_independent() {
        let rl = RateLimiter::new(2, 0.0);
        assert!(rl.check("a"));
        assert!(rl.check("a"));
        assert!(!rl.check("a"));

        assert!(rl.check("b"));
        assert!(rl.check("b"));
        assert!(!rl.check("b"));
    }

    #[test]
    fn test_refill_over_time() {
        let rl = RateLimiter::new(2, 10.0); // 10 tokens/sec
        assert!(rl.check("key"));
        assert!(rl.check("key"));
        assert!(!rl.check("key"));

        thread::sleep(Duration::from_millis(110)); // ~1.1 tokens refilled
        assert!(rl.check("key"));
    }

    #[test]
    fn test_from_env_uses_defaults_when_unset() {
        // Ensure the vars are not set for this test.
        std::env::remove_var("RATE_LIMIT_CAPACITY");
        std::env::remove_var("RATE_LIMIT_RPS");
        let rl = RateLimiter::from_env();
        // Defaults: capacity=60.  Should allow 60 consecutive requests.
        for i in 0..60 {
            assert!(rl.check("env-test"), "request {} should succeed", i);
        }
        assert!(!rl.check("env-test"), "request 61 should be rate-limited");
    }

    #[test]
    fn test_from_env_reads_capacity_env_var() {
        std::env::set_var("RATE_LIMIT_CAPACITY", "3");
        std::env::remove_var("RATE_LIMIT_RPS");
        let rl = RateLimiter::from_env();
        std::env::remove_var("RATE_LIMIT_CAPACITY");

        assert!(rl.check("cap-test"));
        assert!(rl.check("cap-test"));
        assert!(rl.check("cap-test"));
        assert!(!rl.check("cap-test")); // 4th should fail
    }

    #[test]
    fn test_from_env_falls_back_on_invalid_value() {
        std::env::set_var("RATE_LIMIT_CAPACITY", "not-a-number");
        std::env::remove_var("RATE_LIMIT_RPS");
        // Should not panic; falls back to default capacity (60).
        let rl = RateLimiter::from_env();
        std::env::remove_var("RATE_LIMIT_CAPACITY");
        // First request must succeed (bucket has tokens).
        assert!(rl.check("fallback-test"));
    }
}
