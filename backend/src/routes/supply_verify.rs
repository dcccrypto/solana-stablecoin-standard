//! SSS-BUG-026: On-chain supply reconciliation.
//!
//! `GET /api/supply/verify?token_mint=<mint>` returns both the DB-computed
//! circulating supply and the authoritative on-chain value from
//! `getTokenSupply`.  A mismatch above the configurable threshold is flagged
//! as `mismatch: true` in the response and logged at WARN level.
//!
//! ## Environment Variables
//!
//! - `SOLANA_RPC_URL` — Solana JSON-RPC endpoint (default: devnet).
//! - `SSS_TOKEN_MINT` — default token mint when no query param supplied.
//! - `SSS_SUPPLY_MISMATCH_THRESHOLD` — allowed delta in lamports before
//!   flagging (default: 0, i.e. exact match required).

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{error::AppError, state::AppState};

#[derive(Debug, Deserialize)]
pub struct SupplyVerifyQuery {
    pub token_mint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SupplyVerifyResponse {
    pub token_mint: String,
    /// Circulating supply computed from the local DB (minted − burned).
    pub db_supply: u64,
    /// Circulating supply reported by `getTokenSupply` on-chain.
    /// `null` when the RPC call fails (response still includes `rpc_error`).
    pub onchain_supply: Option<u64>,
    /// `true` when |db_supply − onchain_supply| > threshold.
    pub mismatch: bool,
    /// Absolute delta between DB and on-chain supplies.
    pub delta: Option<u64>,
    /// Mismatch threshold used for this check (lamports).
    pub threshold: u64,
    /// RPC error message, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_error: Option<String>,
}

pub async fn supply_verify(
    State(state): State<AppState>,
    Query(query): Query<SupplyVerifyQuery>,
) -> Result<Json<SupplyVerifyResponse>, AppError> {
    let token_mint = query
        .token_mint
        .or_else(|| std::env::var("SSS_TOKEN_MINT").ok())
        .unwrap_or_else(|| "all".to_string());

    let threshold: u64 = std::env::var("SSS_SUPPLY_MISMATCH_THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // --- DB supply ---
    let (total_minted, total_burned) = state.db.get_supply(
        if token_mint == "all" { None } else { Some(token_mint.as_str()) },
    )?;
    let db_supply = total_minted.saturating_sub(total_burned);

    // --- On-chain supply via getTokenSupply ---
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());

    let (onchain_supply, rpc_error) = if token_mint == "all" {
        // Cannot call getTokenSupply without a specific mint — return None.
        (None, Some("token_mint required for on-chain check".to_string()))
    } else {
        match fetch_token_supply(&rpc_url, &token_mint).await {
            Ok(amount) => (Some(amount), None),
            Err(e) => {
                warn!(
                    token_mint = %token_mint,
                    error = %e,
                    "supply_verify: getTokenSupply RPC call failed"
                );
                (None, Some(e.to_string()))
            }
        }
    };

    let (mismatch, delta) = match onchain_supply {
        Some(onchain) => {
            let delta = db_supply.abs_diff(onchain);
            let mismatch = delta > threshold;
            if mismatch {
                warn!(
                    token_mint = %token_mint,
                    db_supply,
                    onchain_supply = onchain,
                    delta,
                    threshold,
                    "SSS-BUG-026 ALERT: on-chain supply mismatch exceeds threshold"
                );
            }
            (mismatch, Some(delta))
        }
        None => (false, None),
    };

    Ok(Json(SupplyVerifyResponse {
        token_mint,
        db_supply,
        onchain_supply,
        mismatch,
        delta,
        threshold,
        rpc_error,
    }))
}

/// Call `getTokenSupply` and return the UI amount as a u64 (raw lamports).
async fn fetch_token_supply(
    rpc_url: &str,
    token_mint: &str,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    use hyper::body::Bytes;
    use hyper::{Method, Request};
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::TokioExecutor;
    use http_body_util::{BodyExt, Full};

    let request_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenSupply",
        "params": [token_mint]
    });

    let body_bytes = serde_json::to_vec(&request_body)?;

    let req = Request::builder()
        .method(Method::POST)
        .uri(rpc_url)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(body_bytes)))?;

    let client = Client::builder(TokioExecutor::new()).build_http::<Full<Bytes>>();
    let resp = client.request(req).await?;

    let body = resp.into_body().collect().await?.to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body)?;

    // Extract result.value.amount (string, base-10 raw lamports)
    let amount_str = json
        .pointer("/result/value/amount")
        .and_then(|v| v.as_str())
        .ok_or("getTokenSupply: missing result.value.amount")?;

    let amount: u64 = amount_str.parse()?;
    Ok(amount)
}

/// Background reconciliation worker (SSS-BUG-026).
///
/// Spawned at startup; checks every `SSS_RECONCILE_INTERVAL_SECS` seconds
/// (default: 300).  Logs a WARN for each mint where the delta exceeds the
/// threshold.
pub async fn start_reconciliation_worker(state: crate::state::AppState) {
    let interval_secs: u64 = std::env::var("SSS_RECONCILE_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300);

    let threshold: u64 = std::env::var("SSS_SUPPLY_MISMATCH_THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;

        // Collect distinct token mints from the event log.
        let mints = match state.db.list_token_mints() {
            Ok(m) => m,
            Err(e) => {
                warn!("reconciliation_worker: failed to list mints: {}", e);
                continue;
            }
        };

        for mint in mints {
            let (total_minted, total_burned) = match state.db.get_supply(Some(&mint)) {
                Ok(v) => v,
                Err(e) => {
                    warn!(mint = %mint, error = %e, "reconciliation_worker: DB supply error");
                    continue;
                }
            };
            let db_supply = total_minted.saturating_sub(total_burned);

            match fetch_token_supply(&rpc_url, &mint).await {
                Ok(onchain) => {
                    let delta = db_supply.abs_diff(onchain);
                    if delta > threshold {
                        warn!(
                            mint = %mint,
                            db_supply,
                            onchain_supply = onchain,
                            delta,
                            threshold,
                            "SSS-BUG-026 PERIODIC ALERT: on-chain supply mismatch"
                        );
                    }
                }
                Err(e) => {
                    warn!(mint = %mint, error = %e, "reconciliation_worker: RPC error");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mismatch_detection_above_threshold() {
        let db_supply: u64 = 1_000_000;
        let onchain: u64 = 1_000_500;
        let threshold: u64 = 100;
        let delta = db_supply.abs_diff(onchain);
        assert!(delta > threshold);
    }

    #[test]
    fn test_no_mismatch_within_threshold() {
        let db_supply: u64 = 1_000_000;
        let onchain: u64 = 1_000_050;
        let threshold: u64 = 100;
        let delta = db_supply.abs_diff(onchain);
        assert!(delta <= threshold);
    }

    #[test]
    fn test_exact_match() {
        let db_supply: u64 = 5_000_000;
        let onchain: u64 = 5_000_000;
        let delta = db_supply.abs_diff(onchain);
        assert_eq!(delta, 0);
    }
}
