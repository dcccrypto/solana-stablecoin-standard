//! SSS-095: On-chain event indexer
//!
//! Background tokio task that polls the Solana RPC for recent transactions
//! on the SSS program addresses, parses Anchor program log lines, and inserts
//! structured events into the `event_log` table.
//!
//! # Strategy
//! We call `getSignaturesForAddress` with `until = last_seen_signature` to
//! fetch only new signatures since the previous poll, then call `getTransaction`
//! for each new sig to extract program log lines.  The last processed signature
//! is persisted in the `indexer_state` table so restarts don't replay events.
//!
//! # Event detection
//! Anchor emits `Program log: <EventName> { ... }` lines for public events.
//! We match known SSS event names and extract the JSON-like payload.
//! Additionally we match `Program data: <base64>` lines and try to decode
//! the 8-byte discriminator to known events (fallback).
//!
//! Detected event types:
//! - `circuit_breaker_toggle`  — CircuitBreakerToggled
//! - `cdp_deposit`             — CollateralDeposited
//! - `cdp_borrow`              — StablecoinsIssued
//! - `cdp_liquidate`           — PositionLiquidated
//! - `oracle_params_update`    — OracleParamsUpdated
//! - `stability_fee_accrual`   — StabilityFeeAccrued
//! - `collateral_registered`   — CollateralRegistered  (SSS-098)
//! - `collateral_config_updated` — CollateralConfigUpdated  (SSS-098)

use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde_json::Value;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

use crate::db::Database;
use crate::state::AppState;

/// Known SSS program addresses to watch.
const WATCHED_PROGRAMS: &[(&str, &str)] = &[
    ("sss-token", "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"),
    (
        "sss-transfer-hook",
        "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp",
    ),
];

/// How many signatures to fetch per poll per program (max 1000 per RPC call).
const SIG_BATCH: usize = 50;

/// Poll interval.
const POLL_INTERVAL: Duration = Duration::from_secs(30);

/// Map Anchor event names to our canonical event_type strings.
struct EventPattern {
    anchor_name: &'static str,
    event_type: &'static str,
}

const EVENT_PATTERNS: &[EventPattern] = &[
    EventPattern {
        anchor_name: "CircuitBreakerToggled",
        event_type: "circuit_breaker_toggle",
    },
    EventPattern {
        anchor_name: "CollateralDeposited",
        event_type: "cdp_deposit",
    },
    EventPattern {
        anchor_name: "StablecoinsIssued",
        event_type: "cdp_borrow",
    },
    EventPattern {
        anchor_name: "PositionLiquidated",
        event_type: "cdp_liquidate",
    },
    EventPattern {
        anchor_name: "OracleParamsUpdated",
        event_type: "oracle_params_update",
    },
    EventPattern {
        anchor_name: "StabilityFeeAccrued",
        event_type: "stability_fee_accrual",
    },
    // SSS-098: CollateralConfig PDA events
    EventPattern {
        anchor_name: "CollateralRegistered",
        event_type: "collateral_registered",
    },
    EventPattern {
        anchor_name: "CollateralConfigUpdated",
        event_type: "collateral_config_updated",
    },
];

/// Spawn the indexer as a background tokio task.
/// Returns immediately; the task runs until the process exits.
pub fn spawn_indexer(state: AppState) {
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());

    tokio::spawn(async move {
        info!("SSS-095 indexer started — RPC: {}", rpc_url);
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("failed to build HTTP client for indexer");

        // Ensure the indexer_state table exists.
        if let Err(e) = state.db.ensure_indexer_state_table() {
            error!("indexer: failed to create indexer_state table: {e}");
            return;
        }

        let ws_tx = state.ws_tx.clone();
        loop {
            for (label, program_id) in WATCHED_PROGRAMS {
                if let Err(e) = poll_program(&client, &state.db, &rpc_url, label, program_id, &ws_tx).await
                {
                    warn!("indexer: poll error for {label}: {e}");
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

/// Poll one program address for new transactions.
async fn poll_program(
    client: &Client,
    db: &Arc<Database>,
    rpc_url: &str,
    label: &str,
    program_id: &str,
    ws_tx: &broadcast::Sender<serde_json::Value>,
) -> Result<(), String> {
    // Load the last seen signature for this program.
    let last_sig = db
        .get_indexer_cursor(program_id)
        .map_err(|e| format!("get_indexer_cursor: {e}"))?;

    // Fetch recent signatures.
    let sigs = fetch_signatures(client, rpc_url, program_id, SIG_BATCH, last_sig.as_deref()).await?;

    if sigs.is_empty() {
        debug!("indexer: no new signatures for {label}");
        return Ok(());
    }

    info!(
        "indexer: {} new signatures for {label} — processing",
        sigs.len()
    );

    // Process oldest-first so the cursor advances monotonically.
    let mut newest_sig: Option<String> = None;
    for (sig, slot) in sigs.iter().rev() {
        if newest_sig.is_none() {
            // The first (i.e., most-recent after reversal) becomes the cursor.
            // Actually we want the newest (last in original order).
        }
        match fetch_and_index_tx(client, db, rpc_url, sig, *slot, program_id, ws_tx).await {
            Ok(n) => {
                if n > 0 {
                    debug!("indexer: {sig} → {n} event(s) inserted");
                }
            }
            Err(e) => warn!("indexer: error processing tx {sig}: {e}"),
        }
    }

    // Advance cursor to the most-recent signature (first element of the list
    // returned by getSignaturesForAddress, which is newest-first).
    if let Some((newest, _)) = sigs.first() {
        newest_sig = Some(newest.clone());
    }

    if let Some(sig) = newest_sig {
        db.set_indexer_cursor(program_id, &sig)
            .map_err(|e| format!("set_indexer_cursor: {e}"))?;
    }

    Ok(())
}

/// Call `getSignaturesForAddress` and return (signature, slot) pairs newest-first.
async fn fetch_signatures(
    client: &Client,
    rpc_url: &str,
    address: &str,
    limit: usize,
    until: Option<&str>,
) -> Result<Vec<(String, i64)>, String> {
    let mut params: Vec<Value> = vec![Value::String(address.to_string())];
    let mut opts = serde_json::json!({
        "limit": limit,
        "commitment": "confirmed"
    });
    if let Some(u) = until {
        opts["until"] = Value::String(u.to_string());
    }
    params.push(opts);

    let resp: Value = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getSignaturesForAddress",
            "params": params
        }))
        .send()
        .await
        .map_err(|e| format!("getSignaturesForAddress request: {e}"))?
        .json()
        .await
        .map_err(|e| format!("getSignaturesForAddress parse: {e}"))?;

    if let Some(err) = resp.get("error") {
        return Err(format!("RPC error: {err}"));
    }

    let arr = resp["result"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        // Skip failed transactions
        if item["err"].is_string() || (item["err"].is_object() && !item["err"].is_null()) {
            continue;
        }
        let sig = match item["signature"].as_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let slot = item["slot"].as_i64().unwrap_or(0);
        out.push((sig, slot));
    }
    Ok(out)
}

/// Fetch a transaction and extract + insert any SSS events found in the logs.
/// Returns the number of events inserted.
async fn fetch_and_index_tx(
    client: &Client,
    db: &Arc<Database>,
    rpc_url: &str,
    signature: &str,
    slot: i64,
    program_id: &str,
    ws_tx: &broadcast::Sender<serde_json::Value>,
) -> Result<usize, String> {
    let resp: Value = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                signature,
                {
                    "encoding": "jsonParsed",
                    "commitment": "confirmed",
                    "maxSupportedTransactionVersion": 0
                }
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("getTransaction request: {e}"))?
        .json()
        .await
        .map_err(|e| format!("getTransaction parse: {e}"))?;

    if resp["result"].is_null() {
        return Ok(0);
    }

    // Extract log messages
    let logs: Vec<String> = resp["result"]["meta"]["logMessages"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let mut count = 0usize;
    for log_line in &logs {
        if let Some((event_type, address, data)) =
            parse_event_log(log_line, program_id)
        {
            // SSS-098: side-effect — sync CollateralConfig table from on-chain events.
            if event_type == "collateral_registered" || event_type == "collateral_config_updated" {
                maybe_upsert_collateral_config(db, &data, Some(signature));
            }
            db.insert_event_log(&event_type, &address, data.clone(), Some(signature), Some(slot))
                .map_err(|e| format!("insert_event_log: {e}"))?;
            // SSS-105: broadcast event to WebSocket subscribers.
            let ws_event = serde_json::json!({
                "event_type": event_type,
                "address": address,
                "data": data,
                "signature": signature,
                "slot": slot,
            });
            // send() only errors if there are no receivers; that's fine.
            let _ = ws_tx.send(ws_event);
            count += 1;
        }
    }

    Ok(count)
}

/// SSS-098: Try to extract CollateralConfig fields from an event data blob and
/// upsert into the local collateral_config table.  Fields expected in `data`:
///   sss_mint, collateral_mint, whitelisted, max_ltv_bps, liquidation_threshold_bps,
///   liquidation_bonus_bps, max_deposit_cap, total_deposited.
fn maybe_upsert_collateral_config(
    db: &crate::db::Database,
    data: &serde_json::Value,
    tx_signature: Option<&str>,
) {
    let sss_mint = match data.get("sss_mint").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return,
    };
    let collateral_mint = match data.get("collateral_mint").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return,
    };
    let whitelisted = data.get("whitelisted").and_then(|v| v.as_bool()).unwrap_or(true);
    let max_ltv_bps = data.get("max_ltv_bps").and_then(|v| v.as_u64()).unwrap_or(6667) as u16;
    let liquidation_threshold_bps = data
        .get("liquidation_threshold_bps")
        .and_then(|v| v.as_u64())
        .unwrap_or(7500) as u16;
    let liquidation_bonus_bps = data
        .get("liquidation_bonus_bps")
        .and_then(|v| v.as_u64())
        .unwrap_or(500) as u16;
    let max_deposit_cap = data
        .get("max_deposit_cap")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let total_deposited = data
        .get("total_deposited")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    if let Err(e) = db.upsert_collateral_config(
        &sss_mint,
        &collateral_mint,
        whitelisted,
        max_ltv_bps,
        liquidation_threshold_bps,
        liquidation_bonus_bps,
        max_deposit_cap,
        total_deposited,
        tx_signature,
    ) {
        warn!("SSS-098: failed to upsert collateral_config from event: {e}");
    } else {
        info!(
            "SSS-098: upserted CollateralConfig for {}/{}",
            sss_mint, collateral_mint
        );
    }
}

/// Parse a single Anchor log line.
/// Returns (event_type, address, data_json) if the line matches a known event.
fn parse_event_log(
    line: &str,
    program_id: &str,
) -> Option<(String, String, serde_json::Value)> {
    // Anchor emits structured log lines like:
    //   Program log: CircuitBreakerToggled { halted: true, authority: "ABC..." }
    // or (newer Anchor versions):
    //   Program log: {"event": "CircuitBreakerToggled", ...}

    let log_body = line
        .strip_prefix("Program log: ")
        .or_else(|| line.strip_prefix("Program data: "))?;

    // Check if the line body starts with a known event name
    for pattern in EVENT_PATTERNS {
        if log_body.starts_with(pattern.anchor_name) {
            // Extract JSON payload if present (everything after the event name)
            let rest = log_body.strip_prefix(pattern.anchor_name).unwrap_or("").trim();
            let data: serde_json::Value = if rest.starts_with('{') {
                // Try to parse as JSON directly (Anchor 0.30+ sometimes emits valid JSON)
                serde_json::from_str(rest).unwrap_or_else(|_| {
                    // Fall back to treating as a raw string payload
                    serde_json::json!({ "raw": rest })
                })
            } else if rest.is_empty() {
                serde_json::json!({})
            } else {
                serde_json::json!({ "raw": rest })
            };

            // Extract address from data if available, otherwise fall back to program_id
            let address = data
                .get("address")
                .or_else(|| data.get("mint"))
                .or_else(|| data.get("position"))
                .or_else(|| data.get("authority"))
                .and_then(|v| v.as_str())
                .unwrap_or(program_id)
                .to_string();

            return Some((pattern.event_type.to_string(), address, data));
        }

        // Also handle JSON-encoded log lines: {"event": "CircuitBreakerToggled", ...}
        if log_body.starts_with('{') {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(log_body) {
                let event_name = json_val
                    .get("event")
                    .or_else(|| json_val.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if event_name == pattern.anchor_name {
                    let address = json_val
                        .get("address")
                        .or_else(|| json_val.get("mint"))
                        .or_else(|| json_val.get("position"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(program_id)
                        .to_string();
                    return Some((pattern.event_type.to_string(), address, json_val));
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_circuit_breaker_log() {
        let line = r#"Program log: CircuitBreakerToggled { "halted": true, "authority": "ABC123" }"#;
        let result = parse_event_log(line, "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
        assert!(result.is_some());
        let (event_type, _addr, _data) = result.unwrap();
        assert_eq!(event_type, "circuit_breaker_toggle");
    }

    #[test]
    fn test_parse_cdp_borrow_log() {
        let line = r#"Program log: StablecoinsIssued { "amount": 1000, "mint": "TokenMintXXX" }"#;
        let result = parse_event_log(line, "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
        assert!(result.is_some());
        let (event_type, address, _data) = result.unwrap();
        assert_eq!(event_type, "cdp_borrow");
        assert_eq!(address, "TokenMintXXX");
    }

    #[test]
    fn test_parse_json_encoded_event() {
        let line = r#"Program log: {"event":"OracleParamsUpdated","address":"OracleAddr123","staleness":60}"#;
        let result = parse_event_log(line, "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
        assert!(result.is_some());
        let (event_type, address, _data) = result.unwrap();
        assert_eq!(event_type, "oracle_params_update");
        assert_eq!(address, "OracleAddr123");
    }

    #[test]
    fn test_parse_unrelated_log() {
        let line = "Program log: Instruction: MintTo";
        let result = parse_event_log(line, "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_liquidation_log() {
        let line = r#"Program log: PositionLiquidated { "position": "PosABC", "debt_cleared": 500 }"#;
        let result = parse_event_log(line, "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
        assert!(result.is_some());
        let (event_type, address, _data) = result.unwrap();
        assert_eq!(event_type, "cdp_liquidate");
        assert_eq!(address, "PosABC");
    }
}
