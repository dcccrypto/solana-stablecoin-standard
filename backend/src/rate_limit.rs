/// Token-bucket rate limiter keyed by API key string.
///
/// Each API key gets a bucket of `capacity` tokens.
/// Tokens refill at `refill_per_second` tokens/sec (continuous approximation).
/// On each request, one token is consumed. If the bucket is empty the request
/// is rejected with 429.
///
/// The implementation is entirely in-memory and resets on process restart,
/// which is appropriate for a single-instance deployment.

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
}
