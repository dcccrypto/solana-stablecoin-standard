//! SSS-108: Liquidation analytics + CDP health score endpoints.
//!
//! # Endpoints
//! | Method | Path                              | Description                              |
//! |--------|-----------------------------------|------------------------------------------|
//! | GET    | /api/analytics/liquidations       | Liquidation volume & stats over a window |
//! | GET    | /api/analytics/cdp-health         | Distribution of CDP health ratios        |
//! | GET    | /api/analytics/protocol-stats     | Total collateral, debt, backstop fund    |
//!
//! ## GET /api/analytics/liquidations
//! Query params:
//! - `window`: `24h` | `7d` | `30d`  (default: `24h`)
//!
//! Response:
//! ```json
//! {
//!   "ok": true,
//!   "data": {
//!     "window": "24h",
//!     "count": 5,
//!     "total_collateral_seized": 12345,
//!     "total_debt_repaid": 9800,
//!     "avg_collateral_seized": 2469
//!   }
//! }
//! ```
//!
//! ## GET /api/analytics/cdp-health
//! Response:
//! ```json
//! {
//!   "ok": true,
//!   "data": {
//!     "healthy": 120,
//!     "at_risk": 15,
//!     "liquidatable": 3,
//!     "total": 138
//!   }
//! }
//! ```
//!
//! ## GET /api/analytics/protocol-stats
//! Response:
//! ```json
//! {
//!   "ok": true,
//!   "data": {
//!     "total_collateral_locked_native": 500000,
//!     "total_debt_native": 300000,
//!     "backstop_fund_debt_repaid": 42000,
//!     "active_collateral_types": 2
//!   }
//! }
//! ```

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
    #[serde(default)]
    pub window: Window,
}

// ─── Response models ──────────────────────────────────────────────────────────

/// Liquidation analytics over a time window.
#[derive(Debug, Serialize)]
pub struct LiquidationAnalyticsResponse {
    pub window: String,
    pub count: u64,
    pub total_collateral_seized: i64,
    pub total_debt_repaid: i64,
    pub avg_collateral_seized: i64,
}

/// CDP health distribution.
#[derive(Debug, Serialize)]
pub struct CdpHealthResponse {
    /// CDPs with health factor >= 1.5 (well-collateralised).
    pub healthy: u64,
    /// CDPs with health factor between 1.0 and 1.5 (approaching liquidation threshold).
    pub at_risk: u64,
    /// CDPs with health factor < 1.0 (liquidatable now).
    pub liquidatable: u64,
    pub total: u64,
}

/// Protocol-level stats.
#[derive(Debug, Serialize)]
pub struct ProtocolStatsResponse {
    /// Sum of `total_deposited` across all active collateral configs (native units).
    pub total_collateral_locked_native: i64,
    /// Proxy for total debt: total SSS minted - burned (native units).
    pub total_debt_native: i64,
    /// Sum of `debt_repaid` in `liquidation_history` — approximates backstop fund utilisation.
    pub backstop_fund_debt_repaid: i64,
    /// Number of whitelisted collateral types with any deposited collateral.
    pub active_collateral_types: u32,
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
    // Best-effort sync of new on-chain events before computing analytics.
    let _ = state.db.sync_liquidations_from_event_log();

    let (label, hours) = query.window.label_and_hours();
    let stats = state.db.liquidation_analytics(hours)?;

    Ok(Json(ApiResponse::ok(LiquidationAnalyticsResponse {
        window: label.to_string(),
        count: stats.count,
        total_collateral_seized: stats.total_collateral_seized,
        total_debt_repaid: stats.total_debt_repaid,
        avg_collateral_seized: stats.avg_collateral_seized,
    })))
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
