//! SSS-112: Liquidation analytics + protocol stats endpoints.
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

// ---------------------------------------------------------------------------
// Query param structs
// ---------------------------------------------------------------------------

/// Query params for `GET /api/analytics/liquidations`
#[derive(Debug, Deserialize)]
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

/// Query params for `GET /api/analytics/cdp-health`
#[derive(Debug, Deserialize)]
pub struct CdpHealthQuery {
    /// Number of histogram buckets (default 10, max 50)
    pub buckets: Option<u32>,
}

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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `GET /api/analytics/liquidations`
pub async fn get_liquidation_analytics(
    State(state): State<AppState>,
    Query(q): Query<LiquidationAnalyticsQuery>,
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
pub async fn get_cdp_health(
    State(state): State<AppState>,
    Query(q): Query<CdpHealthQuery>,
) -> Result<Json<ApiResponse<CdpHealthResponse>>, AppError> {
    let bucket_count = q.buckets.unwrap_or(10).clamp(1, 50);
    let data = state.db.analytics_cdp_health(bucket_count)?;
    Ok(Json(ApiResponse::ok(data)))
}

/// `GET /api/analytics/protocol-stats`
pub async fn get_protocol_stats(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<ProtocolStatsResponse>>, AppError> {
    let data = state.db.analytics_protocol_stats()?;
    Ok(Json(ApiResponse::ok(data)))
}
