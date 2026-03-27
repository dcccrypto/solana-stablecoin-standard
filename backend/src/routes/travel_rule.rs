//! SSS-127: Travel Rule backend endpoints
//!
//! - GET /api/travel-rule/records?wallet=<addr>&mint=&limit=
//!   Returns indexed TravelRuleRecord events filtered by wallet (originator or beneficiary VASP).
//!   `wallet` is required and must be non-empty (AUDIT3C-M3 fix — prevents bulk data exposure).
//!
//! - GET /api/pid-config
//!   Returns SSS program IDs and travel-rule configuration metadata.
//!
//! SSS-AUDIT2-C: Both endpoints require FLAG_TRAVEL_RULE to be set in the
//! on-chain StablecoinConfig.  Returns 503 Service Unavailable when the flag
//! is off.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};

use crate::feature_flags::FLAG_TRAVEL_RULE;
use crate::models::{ApiResponse, PidConfigResponse, TravelRuleQuery, TravelRuleRecord};
use crate::state::AppState;

/// Convenience alias: structured error response matching the ApiResponse contract.
type ApiError = (StatusCode, Json<ApiResponse<()>>);

/// Known SSS program IDs (mirrors WATCHED_PROGRAMS in indexer.rs).
const SSS_TOKEN_PROGRAM_ID: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";
const SSS_TRANSFER_HOOK_PROGRAM_ID: &str = "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp";

/// AUDIT3C-M3: Validate that a wallet query param is present and non-empty.
/// Returns `Some(&str)` with the **original** (untrimmed) value when the trimmed
/// form is non-empty, or `None` to signal a 400 Bad Request.
pub(crate) fn require_wallet_param(wallet: Option<&str>) -> Option<&str> {
    match wallet {
        Some(w) if !w.trim().is_empty() => Some(w),
        _ => None,
    }
}

/// GET /api/travel-rule/records
///
/// Returns indexed TravelRuleRecord events filtered by `wallet`
/// (matches originator_vasp OR beneficiary_vasp), `mint`, and `limit`.
///
/// `wallet` is **required** — omitting it or passing an empty string returns 400.
/// This prevents bulk data exposure (AUDIT3C-M3).
///
/// Requires FLAG_TRAVEL_RULE (bit 6) in StablecoinConfig.feature_flags.
pub async fn get_travel_rule_records(
    State(state): State<AppState>,
    Query(params): Query<TravelRuleQuery>,
) -> Result<Json<ApiResponse<Vec<TravelRuleRecord>>>, ApiError> {
    // AUDIT2-C: gate on FLAG_TRAVEL_RULE
    if !state.feature_flags.is_set(FLAG_TRAVEL_RULE) {
        tracing::warn!("travel-rule/records: FLAG_TRAVEL_RULE is not set — returning 503");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiResponse::err("travel rule feature is not enabled")),
        ));
    }

    // AUDIT3C-M3: require non-empty wallet param to prevent bulk data exposure.
    let wallet = match require_wallet_param(params.wallet.as_deref()) {
        Some(w) => w,
        None => {
            tracing::warn!("travel-rule/records: missing or empty wallet param — returning 400");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::err("wallet param is required and must be non-empty")),
            ));
        }
    };

    let limit = params.limit.unwrap_or(100).min(1000);

    let records = state
        .db
        .list_travel_rule_records(
            Some(wallet),
            params.mint.as_deref(),
            limit,
        )
        .map_err(|e| {
            tracing::error!("travel_rule_records query error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err("internal server error")),
            )
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
///
/// Requires FLAG_TRAVEL_RULE (bit 6) in StablecoinConfig.feature_flags.
pub async fn get_pid_config(
    State(state): State<AppState>,
) -> Result<Json<PidConfigResponse>, ApiError> {
    // AUDIT2-C: gate on FLAG_TRAVEL_RULE
    if !state.feature_flags.is_set(FLAG_TRAVEL_RULE) {
        tracing::warn!("pid-config: FLAG_TRAVEL_RULE is not set — returning 503");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiResponse::err("travel rule feature is not enabled")),
        ));
    }

    let threshold: i64 = std::env::var("TRAVEL_RULE_THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    Ok(Json(PidConfigResponse {
        sss_token_program_id: SSS_TOKEN_PROGRAM_ID.to_string(),
        sss_transfer_hook_program_id: SSS_TRANSFER_HOOK_PROGRAM_ID.to_string(),
        travel_rule_indexing_active: true,
        travel_rule_threshold: threshold,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- AUDIT3C-M3: require_wallet_param ---

    #[test]
    fn wallet_param_none_returns_none() {
        assert!(require_wallet_param(None).is_none());
    }

    #[test]
    fn wallet_param_empty_string_returns_none() {
        assert!(require_wallet_param(Some("")).is_none());
    }

    #[test]
    fn wallet_param_whitespace_only_returns_none() {
        assert!(require_wallet_param(Some("   ")).is_none());
    }

    /// Non-empty wallet param returns `Some` with the original (untrimmed) value.
    #[test]
    fn wallet_param_valid_address_returns_original_value() {
        // Base58 address — long form
        let base58 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
        assert_eq!(require_wallet_param(Some(base58)), Some(base58));
        // Short identifier — different format to exercise the same code path distinctly
        let short = "vasp-001";
        assert_eq!(require_wallet_param(Some(short)), Some(short));
    }

    #[test]
    fn wallet_param_tab_newline_whitespace_returns_none() {
        assert!(require_wallet_param(Some("\t\n")).is_none());
    }
}
