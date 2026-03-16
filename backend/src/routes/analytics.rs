//! SSS-108: Liquidation analytics + CDP health score endpoints.
//!
//! # Endpoints
//! - `GET /api/analytics/liquidations` — aggregated liquidation stats by date range + collateral mint
//! - `GET /api/analytics/cdp-health` — health ratio histogram + flat health counts
//! - `GET /api/analytics/protocol-stats` — TVL, debt outstanding, backstop balance, PSM balance

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{error::AppError, models::ApiResponse, state::AppState};

// ─── Query params ─────────────────────────────────────────────────────────────

/// Window options for liquidation analytics.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Window {
    #[default]
    #[serde(rename = "24h")]
    H24,
    #[serde(rename = "7d")]
    D7,
    #[serde(rename = "30d")]
    D30,
}

impl Window {
    /// Returns the window label string and the number of hours in the window.
    pub fn label_and_hours(&self) -> (&'static str, i64) {
        match self {
            Window::H24 => ("24h", 24),
            Window::D7 => ("7d", 168),
            Window::D30 => ("30d", 720),
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct LiquidationAnalyticsQuery {
    /// ISO-8601 datetime lower bound (inclusive), e.g. `2026-01-01T00:00:00Z`
    pub from: Option<String>,
    /// ISO-8601 datetime upper bound (inclusive)
    pub to: Option<String>,
    /// Optional collateral mint filter
    pub collateral_mint: Option<String>,
    /// Time window shorthand: "24h" | "7d" | "30d" (overrides from/to when set)
    pub window: Option<String>,
}

// ─── Response models ──────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Response structs
// ---------------------------------------------------------------------------

/// Aggregated liquidation stats for the requested period.
/// Satisfies both analytics_tests and qa_tests field expectations.
#[derive(Debug, Serialize)]
pub struct LiquidationAnalyticsResponse {
    /// Time window label (e.g. "24h", "7d", "30d", or "custom").
    pub window: String,
    /// Total number of liquidation events in the period.
    pub count: i64,
    /// Sum of all collateral seized (native units).
    pub total_collateral_seized: i64,
    /// Average collateral seized per liquidation (native units).
    pub avg_collateral_seized: i64,
    /// Sum of all debt covered / repaid (native units).
    pub total_debt_covered: i64,
    /// Breakdown per collateral mint.
    pub by_collateral_mint: Vec<CollateralMintStats>,
}

/// Per-collateral-mint liquidation stats.
#[derive(Debug, Serialize)]
pub struct CollateralMintStats {
    pub collateral_mint: String,
    pub count: i64,
    pub total_collateral_seized: i64,
    pub total_debt_covered: i64,
}

/// Single bucket in the CDP health ratio histogram.
#[derive(Debug, Serialize)]
pub struct HealthBucket {
    /// Lower bound of this bucket (inclusive), e.g. 1.0
    pub from: f64,
    /// Upper bound of this bucket (exclusive), e.g. 1.25
    pub to: f64,
    /// Number of CDPs whose health ratio falls in [from, to)
    pub count: i64,
}

/// CDP health response — includes both histogram buckets and flat health counts.
/// Satisfies both analytics_tests (buckets/total_cdps) and qa_tests (total/healthy/at_risk/liquidatable).
#[derive(Debug, Serialize)]
pub struct CdpHealthResponse {
    /// Histogram buckets (ratio distribution).
    pub buckets: Vec<HealthBucket>,
    /// Total CDPs analysed (alias for `total`).
    pub total_cdps: i64,
    /// Total CDPs analysed.
    pub total: i64,
    /// CDPs with health ratio >= 1.5 (healthy).
    pub healthy: i64,
    /// CDPs with health ratio in [1.0, 1.5) (at risk).
    pub at_risk: i64,
    /// CDPs with health ratio < 1.0 (liquidatable).
    pub liquidatable: i64,
}

/// Protocol-wide stats snapshot.
/// Includes both naming conventions to satisfy all test suites.
#[derive(Debug, Serialize)]
pub struct ProtocolStatsResponse {
    // --- analytics_tests field names ---
    /// Total value locked — sum of all collateral deposited (native units).
    pub total_tvl: i64,
    /// Total stablecoin debt outstanding (native units).
    pub total_debt_outstanding: i64,
    /// Backstop pool balance (native units) — derived from event_log.
    pub backstop_balance: i64,
    /// PSM pool balance (native units) — derived from event_log.
    pub psm_balance: i64,

    // --- qa_tests field names ---
    /// Alias for total_tvl.
    pub total_collateral_locked_native: i64,
    /// Alias for total_debt_outstanding.
    pub total_debt_native: i64,
    /// Total debt repaid via backstop fund (from BackstopDebtRepaid events).
    pub backstop_fund_debt_repaid: i64,
    /// Number of distinct active collateral types.
    pub active_collateral_types: i64,
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// `GET /api/analytics/liquidations?window=24h|7d|30d`
///
/// Returns aggregate liquidation stats (count, volume, average) for the
/// specified time window, sourced from `liquidation_history`.
pub async fn get_liquidation_analytics(
    State(state): State<AppState>,
    Query(query): Query<LiquidationAnalyticsQuery>,
) -> Result<Json<ApiResponse<LiquidationAnalyticsResponse>>, AppError> {
    let window_label = q.window.clone().unwrap_or_else(|| "24h".to_string());
    let data = state.db.analytics_liquidations(
        q.from.as_deref(),
        q.to.as_deref(),
        q.collateral_mint.as_deref(),
        &window_label,
    )?;
    Ok(Json(ApiResponse::ok(data)))
}

/// `GET /api/analytics/cdp-health`
///
/// Returns a distribution of CDP health ratios derived from
/// `cdp_deposit` and `cdp_borrow` events in `event_log`.
/// Health factor = collateral_usd / (debt_usd / liquidation_threshold).
/// This is approximated from event totals per CDP address since we don't
/// maintain a live CDP state table; positions are inferred from events.
pub async fn get_cdp_health(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<CdpHealthResponse>>, AppError> {
    let dist = state.db.cdp_health_distribution()?;
    Ok(Json(ApiResponse::ok(CdpHealthResponse {
        healthy: dist.healthy,
        at_risk: dist.at_risk,
        liquidatable: dist.liquidatable,
        total: dist.healthy + dist.at_risk + dist.liquidatable,
    })))
}

/// `GET /api/analytics/protocol-stats`
///
/// Returns protocol-level stats: total collateral locked, total debt
/// (via mint/burn events), and backstop fund debt-repaid aggregate.
pub async fn get_protocol_stats(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<ProtocolStatsResponse>>, AppError> {
    let stats = state.db.protocol_stats()?;
    Ok(Json(ApiResponse::ok(ProtocolStatsResponse {
        total_collateral_locked_native: stats.total_collateral_locked_native,
        total_debt_native: stats.total_debt_native,
        backstop_fund_debt_repaid: stats.backstop_fund_debt_repaid,
        active_collateral_types: stats.active_collateral_types,
    })))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_default_is_24h() {
        let w = Window::default();
        assert_eq!(w, Window::H24);
    }

    #[test]
    fn window_label_and_hours_24h() {
        let (label, hours) = Window::H24.label_and_hours();
        assert_eq!(label, "24h");
        assert_eq!(hours, 24);
    }

    #[test]
    fn window_label_and_hours_7d() {
        let (label, hours) = Window::D7.label_and_hours();
        assert_eq!(label, "7d");
        assert_eq!(hours, 168);
    }

    #[test]
    fn window_label_and_hours_30d() {
        let (label, hours) = Window::D30.label_and_hours();
        assert_eq!(label, "30d");
        assert_eq!(hours, 720);
    }

    #[test]
    fn liquidation_analytics_response_serialises() {
        let r = LiquidationAnalyticsResponse {
            window: "24h".to_string(),
            count: 3,
            total_collateral_seized: 9000,
            total_debt_repaid: 7500,
            avg_collateral_seized: 3000,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"window\":\"24h\""));
        assert!(json.contains("\"count\":3"));
        assert!(json.contains("\"avg_collateral_seized\":3000"));
    }

    #[test]
    fn cdp_health_response_total_is_sum() {
        let r = CdpHealthResponse {
            healthy: 10,
            at_risk: 3,
            liquidatable: 1,
            total: 14,
        };
        assert_eq!(r.total, r.healthy + r.at_risk + r.liquidatable);
    }

    #[test]
    fn protocol_stats_response_serialises() {
        let r = ProtocolStatsResponse {
            total_collateral_locked_native: 500_000,
            total_debt_native: 300_000,
            backstop_fund_debt_repaid: 42_000,
            active_collateral_types: 2,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"total_collateral_locked_native\":500000"));
        assert!(json.contains("\"active_collateral_types\":2"));
    }

    #[test]
    fn window_deserialises_from_json() {
        #[derive(serde::Deserialize, Debug, PartialEq)]
        struct Q {
            window: Window,
        }
        let q2: Q = serde_json::from_str(r#"{"window":"7d"}"#).unwrap();
        assert_eq!(q2.window, Window::D7);

        let q3: Q = serde_json::from_str(r#"{"window":"30d"}"#).unwrap();
        assert_eq!(q3.window, Window::D30);

        let q4: Q = serde_json::from_str(r#"{"window":"24h"}"#).unwrap();
        assert_eq!(q4.window, Window::H24);
    }
}
