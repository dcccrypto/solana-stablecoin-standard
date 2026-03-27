/// POST /api/confidential/transfer
///
/// Initiate a confidential (zero-knowledge encrypted) token transfer using the
/// Token-2022 ConfidentialTransfer extension. The caller provides an
/// ElGamal-encrypted amount and proof context; the backend submits the
/// instruction to the Solana cluster.
///
/// # Schema (request body – JSON)
/// ```json
/// {
///   "source"               : "string",  // base58 source token account
///   "destination"          : "string",  // base58 destination token account
///   "token_mint"           : "string",  // base58 token mint (must have ConfidentialTransfer ext)
///   "encrypted_amount"     : "string",  // hex-encoded ElGamal ciphertext of the transfer amount
///   "source_elgamal_pubkey": "string",  // hex-encoded source ElGamal public key
///   "dest_elgamal_pubkey"  : "string",  // hex-encoded destination ElGamal public key
///   "proof"                : {
///     "equality_proof"     : "string",  // base64-encoded ZK equality proof
///     "range_proof"        : "string"   // base64-encoded ZK range proof (Bulletproof)
///   },
///   "tx_signature"         : "string"   // optional — pre-signed tx signature
/// }
/// ```
///
/// # Schema (response body – 200 OK)
/// ```json
/// {
///   "success": true,
///   "data": {
///     "transfer_id"   : "string",  // internal UUID
///     "source"        : "string",
///     "destination"   : "string",
///     "token_mint"    : "string",
///     "status"        : "string",  // "pending" | "confirmed" | "failed"
///     "tx_signature"  : "string",  // on-chain tx signature
///     "initiated_at"  : "string"   // ISO-8601 UTC
///   }
/// }
/// ```
///
/// # Status codes
/// 501 Not Implemented — stub; confidential transfer submission pending
/// Token-2022 ConfidentialTransfer integration (SSS-033 direction).
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

use crate::feature_flags::FLAG_CONFIDENTIAL_TRANSFERS;
use crate::state::AppState;

/// POST /api/confidential/transfer
///
/// SSS-AUDIT2-C: Returns 503 Service Unavailable when FLAG_CONFIDENTIAL_TRANSFERS
/// is not set.  When the flag is set but the integration is still pending,
/// returns 501 Not Implemented (stub until Token-2022 CT integration is complete).
pub async fn initiate_confidential_transfer(
    State(state): State<AppState>,
) -> impl IntoResponse {
    // AUDIT2-C: gate on FLAG_CONFIDENTIAL_TRANSFERS
    if !state.feature_flags.is_set(FLAG_CONFIDENTIAL_TRANSFERS) {
        tracing::warn!("confidential/transfer: FLAG_CONFIDENTIAL_TRANSFERS is not set — returning 503");
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "success": false,
                "error": "FLAG_CONFIDENTIAL_TRANSFERS is not enabled on this deployment"
            })),
        );
    }

    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "success": false,
            "error": "Not Implemented — confidential transfer is pending Token-2022 ConfidentialTransfer integration",
            "schema": {
                "request_body": {
                    "source": "base58 token account",
                    "destination": "base58 token account",
                    "token_mint": "base58 mint with ConfidentialTransfer extension",
                    "encrypted_amount": "hex ElGamal ciphertext",
                    "source_elgamal_pubkey": "hex ElGamal pubkey",
                    "dest_elgamal_pubkey": "hex ElGamal pubkey",
                    "proof": {
                        "equality_proof": "base64 ZK equality proof",
                        "range_proof": "base64 ZK Bulletproof"
                    },
                    "tx_signature": "string (optional)"
                },
                "response_200": {
                    "transfer_id": "UUID string",
                    "source": "string",
                    "destination": "string",
                    "token_mint": "string",
                    "status": "pending | confirmed | failed",
                    "tx_signature": "string",
                    "initiated_at": "ISO-8601 UTC"
                }
            }
        })),
    )
}
