//! SSS-AUDIT2-C: Background worker that refreshes the feature flags cache from
//! on-chain StablecoinConfig PDA data.
//!
//! Reads `SSS_CONFIG_ACCOUNT` (base58 pubkey) and `SOLANA_RPC_URL` env vars.
//! Polls every 30 s, deserializes `feature_flags` at byte offset 298 (8-byte
//! LE u64) and writes to `AppState::feature_flags`.
//! Also runs `check_incompatible_combos` and fires a Critical alert on mismatch.

use std::time::Duration;
use tracing::{info, warn};

use crate::feature_flags::check_incompatible_combos;
use crate::monitor::alert_manager::{AlertManager, AlertSeverity};
use crate::state::AppState;

/// Byte offset of `feature_flags` field in the serialised StablecoinConfig
/// account (verified against anchor discriminator + layout, matches devnet
/// flagsOffset=298 used in SDK tests).
const FLAGS_BYTE_OFFSET: usize = 298;

/// How often to poll on-chain state.
const POLL_INTERVAL_SECS: u64 = 30;

/// Spawn the flag refresh background worker.
pub async fn start_flag_refresh_worker(state: AppState) {
    // Skip if SOLANA_TX_VERIFY_SKIP is set (unit tests / CI without live RPC)
    if std::env::var("SOLANA_TX_VERIFY_SKIP").is_ok() {
        info!("[flag_refresh] SOLANA_TX_VERIFY_SKIP set — skipping flag refresh worker");
        return;
    }

    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let config_account = std::env::var("SSS_CONFIG_ACCOUNT").unwrap_or_default();

    if config_account.is_empty() {
        warn!(
            "[flag_refresh] SSS_CONFIG_ACCOUNT not set — feature flags cache will remain 0 (all flags off)"
        );
        return;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client build failed");

    info!(
        "[flag_refresh] Starting — account={config_account} rpc={rpc_url} interval={POLL_INTERVAL_SECS}s"
    );

    loop {
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;

        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [config_account, {"encoding": "base64"}]
        });

        let resp = match client.post(&rpc_url).json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                warn!("[flag_refresh] RPC request failed: {e}");
                continue;
            }
        };

        let json: serde_json::Value = match resp.json().await {
            Ok(j) => j,
            Err(e) => {
                warn!("[flag_refresh] Failed to parse RPC response: {e}");
                continue;
            }
        };

        // Extract base64-encoded account data (index 0 of the data array).
        let data_b64 = json
            .pointer("/result/value/data/0")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if data_b64.is_empty() {
            warn!("[flag_refresh] Empty or missing account data in RPC response");
            continue;
        }

        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let data = match STANDARD.decode(data_b64) {
            Ok(d) => d,
            Err(e) => {
                warn!("[flag_refresh] base64 decode error: {e}");
                continue;
            }
        };

        if data.len() < FLAGS_BYTE_OFFSET + 8 {
            warn!(
                "[flag_refresh] Account data too short ({} bytes < {})",
                data.len(),
                FLAGS_BYTE_OFFSET + 8
            );
            continue;
        }

        let flags = u64::from_le_bytes(
            data[FLAGS_BYTE_OFFSET..FLAGS_BYTE_OFFSET + 8]
                .try_into()
                .expect("slice is exactly 8 bytes"),
        );

        let prev = state.feature_flags.get();
        if prev != flags {
            info!("[flag_refresh] feature_flags changed: {prev:#018x} → {flags:#018x}");
        } else {
            info!("[flag_refresh] feature_flags unchanged: {flags:#018x}");
        }
        state.feature_flags.set(flags);

        // Alert on incompatible flag combinations.
        if let Some(msg) = check_incompatible_combos(flags) {
            warn!("[flag_refresh] INCOMPATIBLE FLAG COMBO DETECTED: {msg}");
            let mgr = AlertManager::new(state.clone());
            mgr.fire_alert(
                "incompatible_flag_combo",
                msg,
                AlertSeverity::Critical,
            )
            .await;
        }
    }
}
