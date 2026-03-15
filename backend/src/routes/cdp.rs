/// POST /api/cdp/vault
///
/// Open a Collateralized Debt Position (CDP) vault on-chain via the SSS Anchor
/// program. The caller supplies collateral parameters; the backend derives the
/// vault PDA and submits (or returns) the instruction for the client to sign.
///
/// # Schema (request body – JSON)
/// ```json
/// {
///   "owner"            : "string",  // base58 wallet pubkey of the vault owner
///   "collateral_mint"  : "string",  // base58 pubkey of the collateral token mint
///   "collateral_amount": number,    // u64 — lamports/micro-units of collateral
///   "stable_amount"    : number,    // u64 — stablecoin units to mint against vault
///   "tx_signature"     : "string"   // optional — if already signed on-chain
/// }
/// ```
///
/// # Schema (response body – 200 OK)
/// ```json
/// {
///   "success": true,
///   "data": {
///     "vault_id"         : "string",  // derived PDA address (base58)
///     "owner"            : "string",
///     "collateral_mint"  : "string",
///     "collateral_amount": number,
///     "stable_amount"    : number,
///     "health_factor"    : number,    // f64 — ratio > 1.0 = healthy
///     "created_at"       : "string"   // ISO-8601 UTC
///   }
/// }
/// ```
///
/// # Status codes
/// 501 Not Implemented — stub; full CDP vault logic pending on-chain program
/// deployment (SSS-033 direction).
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

pub async fn open_cdp_vault() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "success": false,
            "error": "Not Implemented — CDP vault creation is pending on-chain program deployment",
            "schema": {
                "request_body": {
                    "owner": "base58 wallet pubkey",
                    "collateral_mint": "base58 token mint pubkey",
                    "collateral_amount": "u64",
                    "stable_amount": "u64",
                    "tx_signature": "string (optional)"
                },
                "response_200": {
                    "vault_id": "string (PDA)",
                    "owner": "string",
                    "collateral_mint": "string",
                    "collateral_amount": "u64",
                    "stable_amount": "u64",
                    "health_factor": "f64",
                    "created_at": "ISO-8601 UTC"
                }
            }
        })),
    )
}
