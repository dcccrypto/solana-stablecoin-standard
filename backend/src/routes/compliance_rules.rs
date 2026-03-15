/// POST /api/compliance/rule
///
/// Add a programmable compliance rule to the SSS rule engine. Rules are
/// evaluated client-side (and eventually on-chain) against every mint/transfer
/// before it is submitted.
///
/// # Schema (request body – JSON)
/// ```json
/// {
///   "rule_type"   : "string",   // "max_transfer", "geo_block", "kyc_level", "velocity"
///   "description" : "string",   // human-readable description
///   "parameters"  : {           // rule-specific parameters (object)
///     "threshold"   : number,   // e.g. max_transfer threshold in micro-units
///     "region_codes": ["string"] // e.g. geo_block: ISO-3166 country codes
///   },
///   "enabled"     : bool        // whether the rule is active immediately
/// }
/// ```
///
/// # Schema (response body – 200 OK)
/// ```json
/// {
///   "success": true,
///   "data": {
///     "rule_id"     : "string",  // UUID
///     "rule_type"   : "string",
///     "description" : "string",
///     "parameters"  : {},
///     "enabled"     : bool,
///     "created_at"  : "string"   // ISO-8601 UTC
///   }
/// }
/// ```
///
/// # Supported rule_type values (planned)
/// - `max_transfer`  : reject transfers exceeding a token-amount threshold
/// - `geo_block`     : reject addresses from specified regions (requires KYC data)
/// - `kyc_level`     : require a minimum KYC clearance level on the counterparty
/// - `velocity`      : reject if cumulative volume per address exceeds limit/window
///
/// # Status codes
/// 501 Not Implemented — stub; rule persistence and evaluation engine pending.
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

pub async fn add_compliance_rule() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "success": false,
            "error": "Not Implemented — programmable compliance rule engine is pending implementation",
            "schema": {
                "request_body": {
                    "rule_type": "string (max_transfer | geo_block | kyc_level | velocity)",
                    "description": "string",
                    "parameters": {
                        "threshold": "number (optional)",
                        "region_codes": ["string (optional)"]
                    },
                    "enabled": "bool"
                },
                "response_200": {
                    "rule_id": "UUID string",
                    "rule_type": "string",
                    "description": "string",
                    "parameters": {},
                    "enabled": "bool",
                    "created_at": "ISO-8601 UTC"
                }
            }
        })),
    )
}
