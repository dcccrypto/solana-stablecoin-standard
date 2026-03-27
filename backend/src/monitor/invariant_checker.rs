#![allow(dead_code)]
// SSS-139: InvariantChecker — polls on-chain state, checks invariants, fires alerts.
// SSS-AUDIT2-C: Added check_incompatible_flags invariant.

use std::time::Duration;
use tracing::{info, warn};

use crate::state::AppState;
use super::alert_manager::{AlertManager, AlertSeverity};

/// Poll interval in seconds (≈10 Solana slots @ 400ms/slot).
const POLL_INTERVAL_SECS: u64 = 4;

/// Minimum reserve ratio threshold (1.0 = 100%).
const MIN_RESERVE_RATIO: f64 = 1.0;

/// Circuit breaker deviation threshold in bps (500 bps = 5%).
const CIRCUIT_BREAKER_BPS: i64 = 500;

/// Invariant result — either ok or a violation with description.
#[derive(Debug, Clone)]
pub enum InvariantStatus {
    Ok,
    Violated { invariant: String, detail: String },
}

/// Check: supply == sum(minted) - sum(burned)
async fn check_supply_consistency(state: &AppState) -> InvariantStatus {
    match state.db.get_supply(None) {
        Ok((minted, burned)) => {
            // circulating = minted - burned; always ≥ 0 by construction
            if burned > minted {
                InvariantStatus::Violated {
                    invariant: "supply_consistency".into(),
                    detail: format!(
                        "burned ({}) > minted ({}): circulating supply would be negative",
                        burned, minted
                    ),
                }
            } else {
                InvariantStatus::Ok
            }
        }
        Err(e) => InvariantStatus::Violated {
            invariant: "supply_consistency".into(),
            detail: format!("DB error: {}", e),
        },
    }
}

/// Check: reserve_ratio >= MIN_RESERVE_RATIO
/// Derived from event_log BackstopDeposit / BackstopWithdraw vs total debt.
async fn check_reserve_ratio(state: &AppState) -> InvariantStatus {
    let Ok((minted, burned)) = state.db.get_supply(None) else {
        return InvariantStatus::Ok; // can't check — skip
    };
    let circulating = minted.saturating_sub(burned) as f64;
    if circulating == 0.0 {
        return InvariantStatus::Ok;
    }

    // Backstop balance from event_log
    let Ok(events) = state.db.query_event_log(None, None, 10_000, 0) else {
        return InvariantStatus::Ok;
    };

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

    let ratio = backstop as f64 / circulating;
    if ratio < MIN_RESERVE_RATIO && backstop > 0 {
        InvariantStatus::Violated {
            invariant: "reserve_ratio".into(),
            detail: format!(
                "reserve ratio {:.4} < minimum {:.4} (backstop={}, circulating={})",
                ratio, MIN_RESERVE_RATIO, backstop, circulating as i64
            ),
        }
    } else {
        InvariantStatus::Ok
    }
}

/// Check: no sanctioned addresses have transacted (compliance blacklist).
async fn check_sanctioned_transactions(state: &AppState) -> InvariantStatus {
    let Ok(blacklist) = state.db.get_blacklist() else {
        return InvariantStatus::Ok;
    };
    if blacklist.is_empty() {
        return InvariantStatus::Ok;
    }

    let Ok(mint_events) = state.db.query_event_log(Some("MintExecuted"), None, 1000, 0) else {
        return InvariantStatus::Ok;
    };
    let Ok(burn_events) = state.db.query_event_log(Some("BurnExecuted"), None, 1000, 0) else {
        return InvariantStatus::Ok;
    };

    let sanctioned: std::collections::HashSet<String> =
        blacklist.into_iter().map(|b| b.address).collect();

    for ev in mint_events.iter().chain(burn_events.iter()) {
        if sanctioned.contains(&ev.address) {
            return InvariantStatus::Violated {
                invariant: "sanctioned_transaction".into(),
                detail: format!(
                    "sanctioned address {} transacted (event_type={})",
                    ev.address, ev.event_type
                ),
            };
        }
        // also check data.recipient / data.source
        for field in ["recipient", "source", "wallet"] {
            if let Some(addr) = ev.data.get(field).and_then(|v| v.as_str()) {
                if sanctioned.contains(addr) {
                    return InvariantStatus::Violated {
                        invariant: "sanctioned_transaction".into(),
                        detail: format!(
                            "sanctioned address {} in field '{}' of event {} (address={})",
                            addr, field, ev.event_type, ev.address
                        ),
                    };
                }
            }
        }
    }
    InvariantStatus::Ok
}

/// Check: circuit_breaker state matches oracle price deviation.
/// Simplified: if peg_deviation_bps > threshold, circuit breaker should be halted.
async fn check_circuit_breaker(state: &AppState) -> InvariantStatus {
    let Ok(events) = state.db.query_event_log(Some("circuit_breaker_toggle"), None, 100, 0) else {
        return InvariantStatus::Ok;
    };

    // Derive current circuit breaker state from latest toggle event
    let is_halted = events
        .iter()
        .max_by_key(|e| e.slot.unwrap_or(0))
        .and_then(|e| e.data.get("halted"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Get oracle price deviation from most recent oracle event
    let Ok(oracle_events) = state.db.query_event_log(Some("oracle_price_update"), None, 10, 0) else {
        return InvariantStatus::Ok;
    };

    let peg_deviation_bps = oracle_events
        .iter()
        .max_by_key(|e| e.slot.unwrap_or(0))
        .and_then(|e| e.data.get("peg_deviation_bps"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    if peg_deviation_bps.abs() > CIRCUIT_BREAKER_BPS && !is_halted {
        return InvariantStatus::Violated {
            invariant: "circuit_breaker".into(),
            detail: format!(
                "peg deviation {}bps exceeds threshold {}bps but circuit breaker is not halted",
                peg_deviation_bps, CIRCUIT_BREAKER_BPS
            ),
        };
    }

    InvariantStatus::Ok
}

/// SSS-AUDIT2-C: Check for incompatible on-chain feature flag combinations.
async fn check_incompatible_flags(state: &AppState) -> InvariantStatus {
    let flags = state.feature_flags.get();
    if let Some(msg) = crate::feature_flags::check_incompatible_combos(flags) {
        InvariantStatus::Violated {
            invariant: "incompatible_flag_combo".into(),
            detail: msg.to_string(),
        }
    } else {
        InvariantStatus::Ok
    }
}

/// Main invariant checker loop — runs every POLL_INTERVAL_SECS seconds.
pub async fn run_invariant_checker(state: AppState) {
    let alert_mgr = AlertManager::new(state.clone());
    info!("[monitor] InvariantChecker started, polling every {}s", POLL_INTERVAL_SECS);

    loop {
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;

        let checks: Vec<(&str, InvariantStatus)> = vec![
            ("supply_consistency", check_supply_consistency(&state).await),
            ("reserve_ratio", check_reserve_ratio(&state).await),
            ("sanctioned_transactions", check_sanctioned_transactions(&state).await),
            ("circuit_breaker", check_circuit_breaker(&state).await),
            ("incompatible_flag_combo", check_incompatible_flags(&state).await),
        ];

        for (name, result) in checks {
            match result {
                InvariantStatus::Ok => {}
                InvariantStatus::Violated { invariant, detail } => {
                    warn!("[monitor] INVARIANT VIOLATION: {} — {}", invariant, detail);
                    alert_mgr
                        .fire_alert(&invariant, &detail, AlertSeverity::Critical)
                        .await;
                }
            }
            let _ = name; // suppress unused warning
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::state::AppState;

    fn make_state() -> AppState {
        let db = Database::new(":memory:").unwrap();
        AppState::new(db)
    }

    #[tokio::test]
    async fn test_supply_consistency_ok_empty() {
        let state = make_state();
        let result = check_supply_consistency(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_supply_consistency_ok_with_events() {
        let state = make_state();
        state.db.record_mint("mint1", 1000, "addr1", None).unwrap();
        state.db.record_burn("mint1", 500, "addr1", None).unwrap();
        let result = check_supply_consistency(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_supply_consistency_violated() {
        // Directly insert into DB to simulate inconsistency (burn > mint)
        // We simulate by inserting burn events via DB directly since the
        // API normally prevents this. Check the raw DB state.
        let db = Database::new(":memory:").unwrap();
        // Insert raw: burn 1000, mint 500 (impossible via API but testable at DB level)
        db.record_mint("mint1", 500, "addr1", None).unwrap();
        db.record_burn("mint1", 1000, "addr1", None).unwrap(); // bypass API guard
        let state = AppState::new(db);
        let result = check_supply_consistency(&state).await;
        assert!(matches!(result, InvariantStatus::Violated { .. }));
    }

    #[tokio::test]
    async fn test_reserve_ratio_ok_no_backstop() {
        let state = make_state();
        state.db.record_mint("mint1", 5000, "addr1", None).unwrap();
        // No backstop events — ratio = 0, but we only alert when backstop > 0
        let result = check_reserve_ratio(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_reserve_ratio_ok_sufficient() {
        let db = Database::new(":memory:").unwrap();
        db.record_mint("mint1", 1000, "addr1", None).unwrap();
        db.insert_event_log("BackstopDeposit", "addr1", serde_json::json!({"amount": 1500}), None, Some(1)).unwrap();
        let state = AppState::new(db);
        let result = check_reserve_ratio(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_sanctioned_ok_empty_blacklist() {
        let state = make_state();
        let result = check_sanctioned_transactions(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_sanctioned_detected() {
        let db = Database::new(":memory:").unwrap();
        let bad_addr = "SanctionedAddr1111111111111111111111111111111";
        db.add_blacklist(bad_addr, "sanctions").unwrap();
        db.insert_event_log(
            "MintExecuted",
            bad_addr,
            serde_json::json!({"amount": 100}),
            None,
            Some(1),
        ).unwrap();
        let state = AppState::new(db);
        let result = check_sanctioned_transactions(&state).await;
        assert!(matches!(result, InvariantStatus::Violated { .. }));
    }

    #[tokio::test]
    async fn test_circuit_breaker_ok_no_events() {
        let state = make_state();
        let result = check_circuit_breaker(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_circuit_breaker_ok_within_threshold() {
        let db = Database::new(":memory:").unwrap();
        db.insert_event_log(
            "oracle_price_update",
            "oracle1",
            serde_json::json!({"peg_deviation_bps": 100}),
            None,
            Some(1),
        ).unwrap();
        let state = AppState::new(db);
        let result = check_circuit_breaker(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }

    #[tokio::test]
    async fn test_circuit_breaker_violated_high_deviation_not_halted() {
        let db = Database::new(":memory:").unwrap();
        db.insert_event_log(
            "oracle_price_update",
            "oracle1",
            serde_json::json!({"peg_deviation_bps": 600}),
            None,
            Some(2),
        ).unwrap();
        // No circuit_breaker_toggle → is_halted = false
        let state = AppState::new(db);
        let result = check_circuit_breaker(&state).await;
        assert!(matches!(result, InvariantStatus::Violated { .. }));
    }

    #[tokio::test]
    async fn test_circuit_breaker_ok_high_deviation_but_halted() {
        let db = Database::new(":memory:").unwrap();
        db.insert_event_log(
            "oracle_price_update",
            "oracle1",
            serde_json::json!({"peg_deviation_bps": 600}),
            None,
            Some(1),
        ).unwrap();
        db.insert_event_log(
            "circuit_breaker_toggle",
            "admin1",
            serde_json::json!({"halted": true}),
            None,
            Some(2),
        ).unwrap();
        let state = AppState::new(db);
        let result = check_circuit_breaker(&state).await;
        assert!(matches!(result, InvariantStatus::Ok));
    }
}
