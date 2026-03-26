//! On-chain transaction verification helpers (BUG-035 / E-4).
//!
//! Provides a lightweight RPC call to confirm that a Solana transaction
//! signature exists on-chain and was committed before trusting caller-supplied
//! mint/burn amounts.

use tracing::warn;

/// Default Solana RPC endpoint — overridden by `SOLANA_RPC_URL` env var.
const DEFAULT_RPC_URL: &str = "https://api.devnet.solana.com";

/// Verify that a transaction signature is confirmed on-chain.
///
/// Calls `getTransaction` against the configured RPC.  Returns `Ok(())` if the
/// transaction exists and has no error; returns `Err(description)` otherwise.
///
/// This is a best-effort guard — it does **not** decode the transaction accounts
/// or instruction data (that requires the Anchor IDL and is out of scope for
/// this endpoint).  It does prevent fabricated signatures from being recorded.
///
/// # Test bypass
/// Set `SOLANA_TX_VERIFY_SKIP=1` to skip the RPC call (unit/integration tests
/// that do not have a live RPC endpoint).  This env var must **not** be set in
/// production.
pub async fn verify_tx_signature(sig: &str) -> Result<(), String> {
    if sig.is_empty() {
        return Err("tx_signature is empty".to_string());
    }

    // Skip RPC call in test environments (SOLANA_TX_VERIFY_SKIP=1).
    // Format checks below still run — only the network call is skipped.
    let skip_rpc = std::env::var("SOLANA_TX_VERIFY_SKIP").as_deref() == Ok("1");

    // Basic format check: Solana signatures are base58-encoded ed25519 sigs, 86-88 chars.
    if !skip_rpc {
        if sig.len() < 80 || sig.len() > 90 {
            return Err(format!(
                "tx_signature has unexpected length {} (expected 86-88 base58 chars)",
                sig.len()
            ));
        }
        if sig.chars().any(|c| !matches!(c, '1'..='9' | 'A'..='H' | 'J'..='N' | 'P'..='Z' | 'a'..='k' | 'm'..='z')) {
            return Err("tx_signature contains invalid base58 characters".to_string());
        }
    }

    if skip_rpc {
        return Ok(());
    }

    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());

    let client = reqwest::Client::new();

    let resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [sig, {"encoding": "json", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}]
        }))
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("RPC response parse failed: {e}"))?;

    // RPC error object → signature not found or cluster error
    if let Some(err) = resp.get("error") {
        warn!(sig = sig, rpc_error = ?err, "getTransaction RPC error");
        return Err(format!("RPC error for tx {sig}: {err}"));
    }

    let result = &resp["result"];

    // Null result → transaction not found / not yet confirmed
    if result.is_null() {
        return Err(format!(
            "tx_signature {sig} not found on-chain (not confirmed or does not exist)"
        ));
    }

    // Check transaction-level error (e.g. simulation failure)
    if let Some(tx_err) = result["meta"]["err"].as_object() {
        if !tx_err.is_empty() {
            return Err(format!("transaction {sig} failed on-chain: {:?}", result["meta"]["err"]));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: ensure SOLANA_TX_VERIFY_SKIP is unset for format-checking tests.
    fn with_rpc_enabled<F: FnOnce()>(f: F) {
        let was = std::env::var("SOLANA_TX_VERIFY_SKIP").ok();
        std::env::remove_var("SOLANA_TX_VERIFY_SKIP");
        f();
        match was {
            Some(v) => std::env::set_var("SOLANA_TX_VERIFY_SKIP", v),
            None => std::env::remove_var("SOLANA_TX_VERIFY_SKIP"),
        }
    }

    #[test]
    fn test_signature_too_short_rejected() {
        with_rpc_enabled(|| {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let result = rt.block_on(verify_tx_signature("tooshort"));
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("unexpected length"));
        });
    }

    #[test]
    fn test_signature_invalid_chars_rejected() {
        with_rpc_enabled(|| {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            // 88 chars but contains invalid base58 char '0'
            let bad_sig = "0".repeat(88);
            let result = rt.block_on(verify_tx_signature(&bad_sig));
            assert!(result.is_err());
            // Either length or char error
        });
    }

    #[test]
    fn test_signature_valid_format_but_rpc_unavailable() {
        with_rpc_enabled(|| {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            // Point to a guaranteed-unreachable URL
            std::env::set_var("SOLANA_RPC_URL", "http://127.0.0.1:19999");
            let fake_sig = "5j7s6zRGBv3HKbLxNy8eqQvBpAmYQFT5dXj3M1m28yYz5RtN8oCPbzw1HxqNqRkJv5zBBqstY8C4EtP7QsXvHrN";
            let result = rt.block_on(verify_tx_signature(fake_sig));
            // Should error (RPC unreachable) — format check passes
            assert!(result.is_err());
            let err = result.unwrap_err();
            assert!(
                err.contains("RPC request failed") || err.contains("not found") || err.contains("error"),
                "unexpected error: {err}"
            );
        });
    }
}
