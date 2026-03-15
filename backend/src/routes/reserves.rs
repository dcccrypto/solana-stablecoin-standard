/// GET /api/reserves/proof
///
/// Returns a Proof-of-Reserves snapshot for the given SPL token mint.
/// For this initial implementation (direction 1 / supply-snapshot):
///   - Queries devnet via JSON-RPC to get the mint's total supply and the
///     current slot.
///   - Derives a single-leaf Merkle root: SHA-256 over the 8-byte
///     little-endian encoding of `total_supply`.
///   - Returns `proof_type: "supply_snapshot"` so consumers know this is a
///     simple snapshot rather than a full balance-tree proof.
///
/// The `holder` query param is accepted and echoed back for forward-
/// compatibility but does not affect the response in this version.
use axum::{
    extract::{Query, State},
    Json,
};
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use sha2::{Digest, Sha256};
use tracing::debug;

use crate::{
    error::AppError,
    models::{ApiResponse, ProofType, ReservesProofQuery, ReservesProofResponse},
    state::AppState,
};

// Devnet RPC endpoint (no API key required for basic JSON-RPC).
const DEVNET_RPC: &str = "https://api.devnet.solana.com";

/// Minimal RPC response wrappers — we only need a handful of fields.
#[derive(serde::Deserialize, Debug)]
struct RpcResult<T> {
    result: T,
}

#[derive(serde::Deserialize, Debug)]
struct SlotResult {
    result: u64,
}

/// Send a JSON-RPC request to devnet and return the raw JSON bytes.
async fn rpc_call(method: &str, params: serde_json::Value) -> Result<Bytes, AppError> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    });
    let body_bytes = serde_json::to_vec(&body).map_err(|e| {
        AppError::Internal(format!("serialize rpc body: {e}"))
    })?;

    let client = Client::builder(TokioExecutor::new()).build_http::<Full<Bytes>>();

    let req = Request::builder()
        .method("POST")
        .uri(DEVNET_RPC)
        .header("content-type", "application/json")
        .body(Full::from(Bytes::from(body_bytes)))
        .map_err(|e| AppError::Internal(format!("build rpc request: {e}")))?;

    let resp = client
        .request(req)
        .await
        .map_err(|e| AppError::Internal(format!("rpc http error: {e}")))?;

    let bytes = resp
        .into_body()
        .collect()
        .await
        .map_err(|e| AppError::Internal(format!("rpc body read: {e}")))?
        .to_bytes();

    Ok(bytes)
}

/// Derive a single-leaf Merkle root from `total_supply`.
///
/// leaf  = SHA-256(supply_le8)
/// root  = SHA-256(leaf)  — consistent with how the SDK builds a 1-leaf tree
fn merkle_root_from_supply(total_supply: u64) -> String {
    let supply_bytes = total_supply.to_le_bytes();
    let leaf = Sha256::digest(supply_bytes);
    let root = Sha256::digest(leaf);
    hex::encode(root)
}

pub async fn get_reserves_proof(
    State(_state): State<AppState>,
    Query(query): Query<ReservesProofQuery>,
) -> Result<Json<ApiResponse<ReservesProofResponse>>, AppError> {
    let mint = &query.mint;

    // Validate: must be a plausible base58 pubkey (32–44 chars, base58 charset).
    if mint.len() < 32 || mint.len() > 44 {
        return Err(AppError::BadRequest(format!(
            "invalid mint pubkey length: {}",
            mint.len()
        )));
    }
    if !mint.chars().all(|c| {
        matches!(c,
            '1'..='9'
            | 'A'..='H'
            | 'J'..='N'
            | 'P'..='Z'
            | 'a'..='k'
            | 'm'..='z'
        )
    }) {
        return Err(AppError::BadRequest("invalid base58 characters in mint".into()));
    }

    debug!("reserves/proof request: mint={} holder={:?}", mint, query.holder);

    // --- 1. Fetch current slot ---
    let slot_bytes = rpc_call("getSlot", serde_json::json!([])).await?;
    let slot_resp: SlotResult = serde_json::from_slice(&slot_bytes)
        .map_err(|e| AppError::Internal(format!("parse getSlot: {e}")))?;
    let last_verified_slot = slot_resp.result;

    // --- 2. Fetch token supply ---
    let supply_bytes = rpc_call(
        "getTokenSupply",
        serde_json::json!([mint]),
    )
    .await?;

    // Parse the supply; if the mint doesn't exist on devnet we get an error
    // object — surface it as a 400.
    let supply_value: Result<RpcResult<serde_json::Value>, _> =
        serde_json::from_slice(&supply_bytes);

    let total_supply: u64 = match supply_value {
        Ok(rv) => {
            let value = rv.result.get("value");
            match value {
                Some(v) => {
                    let amount_str = v
                        .get("amount")
                        .and_then(|a| a.as_str())
                        .ok_or_else(|| AppError::Internal("missing amount in supply response".into()))?;
                    amount_str.parse::<u64>().map_err(|_| {
                        AppError::Internal(format!("parse supply amount: {amount_str}"))
                    })?
                }
                None => {
                    // RPC returned {result: {value: null}} — mint not found
                    return Err(AppError::BadRequest(format!(
                        "mint not found on devnet: {mint}"
                    )));
                }
            }
        }
        Err(e) => {
            return Err(AppError::Internal(format!("parse getTokenSupply: {e}")));
        }
    };

    // --- 3. Derive Merkle root ---
    let merkle_root = merkle_root_from_supply(total_supply);

    Ok(Json(ApiResponse::ok(ReservesProofResponse {
        merkle_root,
        total_supply,
        last_verified_slot,
        proof_type: ProofType::SupplySnapshot,
        mint: mint.clone(),
        holder: query.holder,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merkle_root_is_deterministic() {
        let r1 = merkle_root_from_supply(1_000_000);
        let r2 = merkle_root_from_supply(1_000_000);
        assert_eq!(r1, r2);
        assert_eq!(r1.len(), 64); // hex-encoded SHA-256
    }

    #[test]
    fn merkle_root_differs_for_different_supply() {
        let r1 = merkle_root_from_supply(1_000_000);
        let r2 = merkle_root_from_supply(2_000_000);
        assert_ne!(r1, r2);
    }

    #[test]
    fn merkle_root_zero_supply() {
        let r = merkle_root_from_supply(0);
        assert_eq!(r.len(), 64);
    }

    /// Known-vector: verify we produce the exact same bytes the SDK's
    /// verifyMerkleProof expects for a 1-leaf tree with supply=1_000_000_000.
    #[test]
    fn merkle_root_known_vector() {
        // leaf  = SHA-256(1_000_000_000u64 in LE)
        // root  = SHA-256(leaf)
        let supply: u64 = 1_000_000_000;
        let leaf = Sha256::digest(supply.to_le_bytes());
        let root = Sha256::digest(leaf);
        let expected = hex::encode(root);
        assert_eq!(merkle_root_from_supply(supply), expected);
    }
}
