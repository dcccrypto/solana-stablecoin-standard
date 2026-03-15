/// GET /api/cpi/interface
///
/// Return the SSS CPI (Cross-Program Invocation) interface specification as
/// JSON. Consumers (integrators, SDK generators) use this to discover the
/// discriminators, account layouts, and instruction schemas required to compose
/// with the SSS Anchor program from another on-chain program.
///
/// # Schema (response body – 200 OK)
/// ```json
/// {
///   "success": true,
///   "data": {
///     "program_id"    : "string",         // base58 SSS program address
///     "idl_version"   : "string",         // semver of the IDL this describes
///     "instructions"  : [                 // array of available CPI instructions
///       {
///         "name"          : "string",
///         "discriminator" : "string",     // 8-byte hex discriminator
///         "accounts"      : ["string"],   // required account names in order
///         "args"          : { "name": "type" }
///       }
///     ],
///     "generated_at"  : "string"          // ISO-8601 UTC
///   }
/// }
/// ```
///
/// # Status codes
/// 501 Not Implemented — stub; will be populated from the compiled Anchor IDL
/// once SSS-033 is merged and the program is deployed.
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

pub async fn get_cpi_interface() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "success": false,
            "error": "Not Implemented — CPI interface spec will be auto-generated from Anchor IDL post SSS-033 merge",
            "schema": {
                "response_200": {
                    "program_id": "string (base58)",
                    "idl_version": "string (semver)",
                    "instructions": [
                        {
                            "name": "string",
                            "discriminator": "string (8-byte hex)",
                            "accounts": ["string"],
                            "args": { "field_name": "field_type" }
                        }
                    ],
                    "generated_at": "ISO-8601 UTC"
                }
            }
        })),
    )
}
