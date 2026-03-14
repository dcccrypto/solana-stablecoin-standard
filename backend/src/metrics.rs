//! In-memory Prometheus-style counters for the SSS backend.
//!
//! All counters are `AtomicU64` — lock-free, cheap, and safe to share
//! across Tokio tasks.  The `MetricsState` is cloned cheaply via `Arc`.

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use chrono::Utc;
use serde::Serialize;

/// Shared metrics state.  Clone this to share across handlers.
#[derive(Clone, Default)]
pub struct MetricsState(Arc<Inner>);

#[derive(Default)]
struct Inner {
    /// Total successful mint operations.
    mint_total: AtomicU64,
    /// Total successful burn operations.
    burn_total: AtomicU64,
    /// Total tokens minted (sum of amounts).
    mint_amount_total: AtomicU64,
    /// Total tokens burned (sum of amounts).
    burn_amount_total: AtomicU64,
    /// Total 4xx/5xx error responses returned.
    error_total: AtomicU64,
    /// Total 429 rate-limit responses returned.
    rate_limit_total: AtomicU64,
    /// Total webhook dispatch attempts fired.
    webhook_dispatch_total: AtomicU64,
    /// Total webhook dispatch failures (non-2xx or timeout).
    webhook_failure_total: AtomicU64,
    /// Unix timestamp (seconds) when the server started.
    started_at_secs: AtomicU64,
}

impl MetricsState {
    pub fn new() -> Self {
        let inner = Inner::default();
        inner
            .started_at_secs
            .store(Utc::now().timestamp() as u64, Ordering::Relaxed);
        Self(Arc::new(inner))
    }

    // ── increment helpers ────────────────────────────────────────────────────

    pub fn inc_mint(&self, amount: u64) {
        self.0.mint_total.fetch_add(1, Ordering::Relaxed);
        self.0.mint_amount_total.fetch_add(amount, Ordering::Relaxed);
    }

    pub fn inc_burn(&self, amount: u64) {
        self.0.burn_total.fetch_add(1, Ordering::Relaxed);
        self.0.burn_amount_total.fetch_add(amount, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn inc_error(&self) {
        self.0.error_total.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn inc_rate_limit(&self) {
        self.0.rate_limit_total.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn inc_webhook_dispatch(&self) {
        self.0.webhook_dispatch_total.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn inc_webhook_failure(&self) {
        self.0.webhook_failure_total.fetch_add(1, Ordering::Relaxed);
    }

    // ── snapshot ─────────────────────────────────────────────────────────────

    pub fn snapshot(&self) -> MetricsSnapshot {
        let started = self.0.started_at_secs.load(Ordering::Relaxed);
        let now = Utc::now().timestamp() as u64;
        let uptime_secs = now.saturating_sub(started);

        MetricsSnapshot {
            mint_total: self.0.mint_total.load(Ordering::Relaxed),
            burn_total: self.0.burn_total.load(Ordering::Relaxed),
            mint_amount_total: self.0.mint_amount_total.load(Ordering::Relaxed),
            burn_amount_total: self.0.burn_amount_total.load(Ordering::Relaxed),
            error_total: self.0.error_total.load(Ordering::Relaxed),
            rate_limit_total: self.0.rate_limit_total.load(Ordering::Relaxed),
            webhook_dispatch_total: self.0.webhook_dispatch_total.load(Ordering::Relaxed),
            webhook_failure_total: self.0.webhook_failure_total.load(Ordering::Relaxed),
            uptime_seconds: uptime_secs,
        }
    }
}

/// JSON-serialisable metrics snapshot returned by `GET /api/metrics`.
#[derive(Debug, Serialize)]
pub struct MetricsSnapshot {
    /// Number of successful mint operations since startup.
    pub mint_total: u64,
    /// Number of successful burn operations since startup.
    pub burn_total: u64,
    /// Sum of all minted token amounts since startup.
    pub mint_amount_total: u64,
    /// Sum of all burned token amounts since startup.
    pub burn_amount_total: u64,
    /// Number of error responses (4xx/5xx) since startup.
    pub error_total: u64,
    /// Number of rate-limit (429) responses since startup.
    pub rate_limit_total: u64,
    /// Number of webhook dispatch attempts since startup.
    pub webhook_dispatch_total: u64,
    /// Number of failed webhook dispatches since startup.
    pub webhook_failure_total: u64,
    /// Server uptime in seconds.
    pub uptime_seconds: u64,
}
