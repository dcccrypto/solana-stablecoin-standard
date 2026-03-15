/// GET /api/reserves/proof
///
/// Submit a Merkle inclusion proof to verify that a given leaf is part of the
/// on-chain reserve Merkle tree.
///
/// # Schema (request query params)
/// ```
/// leaf_hash   : String  — hex-encoded leaf hash to prove inclusion for
/// proof       : String  — comma-separated hex-encoded sibling hashes (path)
/// root        : String  — expected Merkle root to verify against
/// ```
///
/// # Schema (response body – 200 OK)
/// ```json
/// {
///   "success": true,
///   "data": {
///     "valid": bool,           // true if proof is cryptographically correct
///     "leaf_hash": "string",   // echo of supplied leaf_hash
///     "root": "string",        // echo of supplied root
///     "verified_at": "string"  // ISO-8601 UTC timestamp
///   }
/// }
/// ```
///
/// # Status codes
/// 501 Not Implemented — endpoint is stubbed; full Merkle verification will be
/// wired to the Anchor program's reserve account once SSS-033 is merged.
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

pub async fn get_reserves_proof() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "success": false,
            "error": "Not Implemented — reserve Merkle proof verification is pending SSS-033 merge",
            "schema": {
                "query_params": {
                    "leaf_hash": "hex-encoded leaf to prove",
                    "proof": "comma-separated hex sibling hashes",
                    "root": "expected Merkle root"
                },
                "response_200": {
                    "valid": "bool",
                    "leaf_hash": "string",
                    "root": "string",
                    "verified_at": "ISO-8601 UTC"
                }
            }
        })),
    )
}
