//! SSS-127: Travel Rule backend endpoints
//!
//! - GET /api/travel-rule/records?wallet=&mint=&limit=
//!   Returns indexed TravelRuleRecord events filtered by wallet (originator or beneficiary VASP).
//!
//! - GET /api/pid-config
//!   Returns SSS program IDs and travel-rule configuration metadata.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};

use crate::models::{ApiResponse, PidConfigResponse, TravelRuleQuery, TravelRuleRecord};
use crate::state::AppState;

/// Known SSS program IDs (mirrors WATCHED_PROGRAMS in indexer.rs).
const SSS_TOKEN_PROGRAM_ID: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";
const SSS_TRANSFER_HOOK_PROGRAM_ID: &str = "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp";

/// GET /api/travel-rule/records
///
/// Returns indexed TravelRuleRecord events.  Optionally filtered by `wallet`
/// (matches originator_vasp OR beneficiary_vasp), `mint`, and `limit`.
pub async fn get_travel_rule_records(
    State(state): State<AppState>,
    Query(params): Query<TravelRuleQuery>,
) -> Result<Json<ApiResponse<Vec<TravelRuleRecord>>>, StatusCode> {
    let limit = params.limit.unwrap_or(100).min(1000);

    let records = state
        .db
        .list_travel_rule_records(
            params.wallet.as_deref(),
            params.mint.as_deref(),
            limit,
        )
        .map_err(|e| {
            tracing::error!("travel_rule_records query error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(records),
        error: None,
    }))
}

/// GET /api/pid-config
///
/// Returns SSS program IDs and travel-rule operational config.
/// `travel_rule_threshold` is read from the TRAVEL_RULE_THRESHOLD env var
/// (set by devops from the on-chain StablecoinConfig); defaults to 0 (unset).
pub async fn get_pid_config(
    State(_state): State<AppState>,
) -> Json<PidConfigResponse> {
    let threshold: i64 = std::env::var("TRAVEL_RULE_THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    Json(PidConfigResponse {
        sss_token_program_id: SSS_TOKEN_PROGRAM_ID.to_string(),
        sss_transfer_hook_program_id: SSS_TRANSFER_HOOK_PROGRAM_ID.to_string(),
        travel_rule_indexing_active: true,
        travel_rule_threshold: threshold,
    })
}
