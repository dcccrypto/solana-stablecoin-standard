// SSS-139: MetricCollector — exports Prometheus metrics.
// Exposes: sss_supply_total, sss_reserve_ratio, sss_active_cdps,
//          sss_peg_deviation_bps

use std::time::Duration;
use std::sync::atomic::{AtomicI64, Ordering};
use tracing::info;

use crate::state::AppState;

/// Scrape interval in seconds.
const SCRAPE_INTERVAL_SECS: u64 = 15;

/// In-memory metric store (atomic i64 values for lock-free reads).
pub static METRIC_SUPPLY_TOTAL: AtomicI64 = AtomicI64::new(0);
pub static METRIC_RESERVE_BALANCE: AtomicI64 = AtomicI64::new(0);
pub static METRIC_ACTIVE_CDPS: AtomicI64 = AtomicI64::new(0);
pub static METRIC_PEG_DEVIATION_BPS: AtomicI64 = AtomicI64::new(0);

/// Render current metrics in Prometheus text format.
pub fn render_prometheus_metrics() -> String {
    let supply = METRIC_SUPPLY_TOTAL.load(Ordering::Relaxed);
    let reserve = METRIC_RESERVE_BALANCE.load(Ordering::Relaxed);
    let cdps = METRIC_ACTIVE_CDPS.load(Ordering::Relaxed);
    let peg_dev = METRIC_PEG_DEVIATION_BPS.load(Ordering::Relaxed);

    // Reserve ratio = reserve / supply (0 if supply == 0)
    let reserve_ratio = if supply > 0 {
        reserve as f64 / supply as f64
    } else {
        0.0
    };

    format!(
        "# HELP sss_supply_total Total circulating supply of SSS stablecoins (lamports)\n\
         # TYPE sss_supply_total gauge\n\
         sss_supply_total {supply}\n\
         # HELP sss_reserve_ratio Current reserve ratio (backstop / circulating supply)\n\
         # TYPE sss_reserve_ratio gauge\n\
         sss_reserve_ratio {reserve_ratio:.6}\n\
         # HELP sss_active_cdps Number of currently active CDPs\n\
         # TYPE sss_active_cdps gauge\n\
         sss_active_cdps {cdps}\n\
         # HELP sss_peg_deviation_bps Current peg deviation in basis points\n\
         # TYPE sss_peg_deviation_bps gauge\n\
         sss_peg_deviation_bps {peg_dev}\n",
        supply = supply,
        reserve_ratio = reserve_ratio,
        cdps = cdps,
        peg_dev = peg_dev,
    )
}

/// Collect and update all metrics from DB state.
async fn collect_metrics(state: &AppState) {
    // sss_supply_total
    if let Ok((minted, burned)) = state.db.get_supply(None) {
        let circulating = minted.saturating_sub(burned) as i64;
        METRIC_SUPPLY_TOTAL.store(circulating, Ordering::Relaxed);
    }

    // sss_reserve_ratio (derived from backstop events)
    if let Ok(events) = state.db.query_event_log(None, None, 10_000, 0) {
        let mut backstop: i64 = 0;
        for ev in &events {
            match ev.event_type.as_str() {
                "BackstopDeposit" => {
                    if let Some(a) = ev.data.get("amount").and_then(|v| v.as_i64()) {
                        backstop += a;
                    }
                }
                "BackstopWithdraw" => {
                    if let Some(a) = ev.data.get("amount").and_then(|v| v.as_i64()) {
                        backstop = backstop.saturating_sub(a);
                    }
                }
                _ => {}
            }
        }
        METRIC_RESERVE_BALANCE.store(backstop, Ordering::Relaxed);
    }

    // sss_active_cdps — count CDPs with net positive collateral (deposits > withdrawals)
    if let Ok(events) = state.db.query_event_log(None, None, 10_000, 0) {
        let mut cdp_deposits: std::collections::HashMap<String, i64> =
            std::collections::HashMap::new();
        let mut cdp_repaid: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        for ev in &events {
            match ev.event_type.as_str() {
                "cdp_deposit" | "CDPOpened" => {
                    *cdp_deposits.entry(ev.address.clone()).or_insert(0) += 1;
                }
                "CDPLiquidated" | "cdp_liquidate" => {
                    cdp_repaid.insert(ev.address.clone());
                }
                _ => {}
            }
        }

        let active = cdp_deposits
            .keys()
            .filter(|addr| !cdp_repaid.contains(*addr))
            .count() as i64;
        METRIC_ACTIVE_CDPS.store(active, Ordering::Relaxed);
    }

    // sss_peg_deviation_bps — from latest oracle_price_update
    if let Ok(events) = state.db.query_event_log(Some("oracle_price_update"), None, 100, 0) {
        if let Some(latest) = events.iter().max_by_key(|e| e.slot.unwrap_or(0)) {
            if let Some(bps) = latest.data.get("peg_deviation_bps").and_then(|v| v.as_i64()) {
                METRIC_PEG_DEVIATION_BPS.store(bps, Ordering::Relaxed);
            }
        }
    }
}

/// Main metric collector loop.
pub async fn run_metric_collector(state: AppState) {
    info!("[monitor] MetricCollector started, scraping every {}s", SCRAPE_INTERVAL_SECS);
    loop {
        collect_metrics(&state).await;
        tokio::time::sleep(Duration::from_secs(SCRAPE_INTERVAL_SECS)).await;
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn make_state() -> AppState {
        let db = Database::new(":memory:").unwrap();
        AppState::new(db)
    }

    #[tokio::test]
    async fn test_metrics_empty_db() {
        // Reset statics before asserting empty-DB behaviour (other tests may have set them).
        METRIC_SUPPLY_TOTAL.store(0, Ordering::Relaxed);
        METRIC_RESERVE_BALANCE.store(0, Ordering::Relaxed);
        METRIC_ACTIVE_CDPS.store(0, Ordering::Relaxed);
        METRIC_PEG_DEVIATION_BPS.store(0, Ordering::Relaxed);

        let state = make_state();
        collect_metrics(&state).await;
        assert_eq!(METRIC_SUPPLY_TOTAL.load(Ordering::Relaxed), 0);
        assert_eq!(METRIC_RESERVE_BALANCE.load(Ordering::Relaxed), 0);
        assert_eq!(METRIC_ACTIVE_CDPS.load(Ordering::Relaxed), 0);
        assert_eq!(METRIC_PEG_DEVIATION_BPS.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn test_metrics_supply_total() {
        let db = Database::new(":memory:").unwrap();
        db.record_mint("mint1", 5000, "addr1", None).unwrap();
        db.record_burn("mint1", 1000, "addr1", None).unwrap();
        let state = AppState::new(db);
        collect_metrics(&state).await;
        assert_eq!(METRIC_SUPPLY_TOTAL.load(Ordering::Relaxed), 4000);
    }

    #[tokio::test]
    async fn test_metrics_reserve_balance() {
        let db = Database::new(":memory:").unwrap();
        db.insert_event_log("BackstopDeposit", "addr1", serde_json::json!({"amount": 3000}), None, Some(1)).unwrap();
        db.insert_event_log("BackstopWithdraw", "addr1", serde_json::json!({"amount": 500}), None, Some(2)).unwrap();
        let state = AppState::new(db);
        collect_metrics(&state).await;
        assert_eq!(METRIC_RESERVE_BALANCE.load(Ordering::Relaxed), 2500);
    }

    #[tokio::test]
    async fn test_metrics_active_cdps() {
        let db = Database::new(":memory:").unwrap();
        db.insert_event_log("CDPOpened", "CDP_A", serde_json::json!({}), None, Some(1)).unwrap();
        db.insert_event_log("CDPOpened", "CDP_B", serde_json::json!({}), None, Some(2)).unwrap();
        db.insert_event_log("CDPOpened", "CDP_C", serde_json::json!({}), None, Some(3)).unwrap();
        // Liquidate C
        db.insert_event_log("CDPLiquidated", "CDP_C", serde_json::json!({}), None, Some(4)).unwrap();
        let state = AppState::new(db);
        collect_metrics(&state).await;
        assert_eq!(METRIC_ACTIVE_CDPS.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn test_metrics_peg_deviation() {
        let db = Database::new(":memory:").unwrap();
        db.insert_event_log("oracle_price_update", "oracle1", serde_json::json!({"peg_deviation_bps": 42}), None, Some(10)).unwrap();
        let state = AppState::new(db);
        collect_metrics(&state).await;
        assert_eq!(METRIC_PEG_DEVIATION_BPS.load(Ordering::Relaxed), 42);
    }

    #[test]
    fn test_render_prometheus_metrics() {
        METRIC_SUPPLY_TOTAL.store(100000, Ordering::Relaxed);
        METRIC_RESERVE_BALANCE.store(120000, Ordering::Relaxed);
        METRIC_ACTIVE_CDPS.store(7, Ordering::Relaxed);
        METRIC_PEG_DEVIATION_BPS.store(15, Ordering::Relaxed);

        let output = render_prometheus_metrics();
        assert!(output.contains("sss_supply_total 100000"));
        assert!(output.contains("sss_reserve_ratio"));
        assert!(output.contains("sss_active_cdps 7"));
        assert!(output.contains("sss_peg_deviation_bps 15"));
    }

    #[test]
    fn test_render_prometheus_zero_supply() {
        METRIC_SUPPLY_TOTAL.store(0, Ordering::Relaxed);
        METRIC_RESERVE_BALANCE.store(5000, Ordering::Relaxed);
        let output = render_prometheus_metrics();
        // reserve_ratio should be 0.0 when supply is 0
        assert!(output.contains("sss_reserve_ratio 0.000000"));
    }
}
