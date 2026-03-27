//! SSS-127: Travel Rule backend endpoints
//!
//! - GET /api/travel-rule/records?wallet=&mint=&limit=
//!   Returns indexed TravelRuleRecord events filtered by wallet (originator or beneficiary VASP).
//!
//! - POST /api/travel-rule/records
//!   AUDIT3C-H1: Submit a new TravelRuleRecord. Validates originator_vasp and
//!   beneficiary_vasp against the known_vasps registry; returns 422 UNKNOWN_VASP
//!   if either is unrecognised.
//!
//! - GET /api/pid-config
//!   Returns SSS program IDs and travel-rule configuration metadata.
//!
//! SSS-AUDIT2-C: All endpoints require FLAG_TRAVEL_RULE to be set in the
//! on-chain StablecoinConfig.  Returns 503 Service Unavailable when the flag
//! is off.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};

use crate::error::AppError;
use crate::feature_flags::FLAG_TRAVEL_RULE;
use crate::models::{ApiResponse, CreateTravelRuleRecord, PidConfigResponse, TravelRuleQuery, TravelRuleRecord};
use crate::state::AppState;
use serde_json;

/// Known SSS program IDs (mirrors WATCHED_PROGRAMS in indexer.rs).
const SSS_TOKEN_PROGRAM_ID: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";
const SSS_TRANSFER_HOOK_PROGRAM_ID: &str = "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp";

/// GET /api/travel-rule/records
///
/// Returns indexed TravelRuleRecord events.  Optionally filtered by `wallet`
/// (matches originator_vasp OR beneficiary_vasp), `mint`, and `limit`.
///
/// Requires FLAG_TRAVEL_RULE (bit 6) in StablecoinConfig.feature_flags.
pub async fn get_travel_rule_records(
    State(state): State<AppState>,
    Query(params): Query<TravelRuleQuery>,
) -> Result<Json<ApiResponse<Vec<TravelRuleRecord>>>, StatusCode> {
    // AUDIT2-C: gate on FLAG_TRAVEL_RULE
    if !state.feature_flags.is_set(FLAG_TRAVEL_RULE) {
        tracing::warn!("travel-rule/records: FLAG_TRAVEL_RULE is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

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

/// POST /api/travel-rule/records
///
/// AUDIT3C-H1: Submit a new TravelRuleRecord. Validates originator_vasp and
/// beneficiary_vasp against the known_vasps registry. Returns 422 with error
/// code UNKNOWN_VASP if either VASP is not registered.
///
/// Requires FLAG_TRAVEL_RULE (bit 6) in StablecoinConfig.feature_flags.
pub async fn post_travel_rule_record(
    State(state): State<AppState>,
    Json(body): Json<CreateTravelRuleRecord>,
) -> Result<(StatusCode, Json<ApiResponse<TravelRuleRecord>>), (StatusCode, Json<serde_json::Value>)> {
    // Gate on FLAG_TRAVEL_RULE
    if !state.feature_flags.is_set(FLAG_TRAVEL_RULE) {
        tracing::warn!("travel-rule/records POST: FLAG_TRAVEL_RULE is not set — returning 503");
        return Err((StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"success": false, "error": "FLAG_TRAVEL_RULE not set"}))));
    }

    // AUDIT3C-H1: validate both VASPs against known_vasps registry
    let record = state.db.insert_travel_rule_record(
        &body.originator_vasp,
        &body.beneficiary_vasp,
        &body.mint,
        body.amount,
        body.threshold,
        body.compliant,
        body.tx_signature.as_deref(),
    ).map_err(|e| {
        let status = match &e {
            AppError::UnprocessableEntity(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(serde_json::json!({"success": false, "error": e.to_string()})))
    })?;

    tracing::info!(
        "travel-rule record created: id={} originator={} beneficiary={}",
        record.id, record.originator_vasp, record.beneficiary_vasp
    );

    Ok((
        StatusCode::CREATED,
        Json(ApiResponse {
            success: true,
            data: Some(record),
            error: None,
        }),
    ))
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
) -> Result<Json<PidConfigResponse>, StatusCode> {
    // AUDIT2-C: gate on FLAG_TRAVEL_RULE
    if !state.feature_flags.is_set(FLAG_TRAVEL_RULE) {
        tracing::warn!("pid-config: FLAG_TRAVEL_RULE is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
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
    use crate::db::Database;
    use crate::state::{AppState, FeatureFlagsCache};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        Router,
    };
    use tower::ServiceExt;
    use axum::routing::{get, post};
    use serde_json::json;
    use std::sync::Arc;
    use tokio::sync::broadcast;

    fn make_state_with_flag(flag_set: bool) -> AppState {
        let db = Database::new(":memory:").expect("in-memory db");
        let ff = Arc::new(FeatureFlagsCache::new());
        if flag_set {
            ff.set(FLAG_TRAVEL_RULE);
        }
        let (ws_tx, _) = broadcast::channel(16);
        AppState {
            db: Arc::new(db),
            rate_limiter: Arc::new(crate::rate_limit::RateLimiter::from_env()),
            ws_tx,
            feature_flags: ff,
        }
    }

    fn make_app(state: AppState) -> Router {
        Router::new()
            .route("/api/travel-rule/records", get(get_travel_rule_records).post(post_travel_rule_record))
            .with_state(state)
    }

    async fn post_record(app: Router, body: serde_json::Value) -> axum::response::Response {
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/travel-rule/records")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    /// AUDIT3C-H1-T1: known VASPs → 201 Created
    #[tokio::test]
    async fn test_post_known_vasps_returns_201() {
        let app = make_app(make_state_with_flag(true));
        let resp = post_record(app, json!({
            "originator_vasp": "SSSISSUER001",
            "beneficiary_vasp": "SSSMARKET001",
            "mint": "So11111111111111111111111111111111111111112",
            "amount": 1000000,
            "threshold": 1000,
            "compliant": true,
            "tx_signature": "testsig1"
        })).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    /// AUDIT3C-H1-T2: unknown originator_vasp → 422 UNKNOWN_VASP
    #[tokio::test]
    async fn test_post_unknown_originator_returns_422() {
        let app = make_app(make_state_with_flag(true));
        let resp = post_record(app, json!({
            "originator_vasp": "FORGEDVASP99",
            "beneficiary_vasp": "SSSMARKET001",
            "mint": "So11111111111111111111111111111111111111112",
            "amount": 500000,
            "threshold": 1000,
            "compliant": false
        })).await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["error"].as_str().unwrap().contains("UNKNOWN_VASP"));
        assert!(v["error"].as_str().unwrap().contains("originator_vasp"));
    }

    /// AUDIT3C-H1-T3: unknown beneficiary_vasp → 422 UNKNOWN_VASP
    #[tokio::test]
    async fn test_post_unknown_beneficiary_returns_422() {
        let app = make_app(make_state_with_flag(true));
        let resp = post_record(app, json!({
            "originator_vasp": "SSSISSUER001",
            "beneficiary_vasp": "0x0000",
            "mint": "So11111111111111111111111111111111111111112",
            "amount": 500000,
            "threshold": 1000,
            "compliant": false
        })).await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["error"].as_str().unwrap().contains("UNKNOWN_VASP"));
        assert!(v["error"].as_str().unwrap().contains("beneficiary_vasp"));
    }

    /// AUDIT3C-H1-T4: flag off → 503
    #[tokio::test]
    async fn test_post_flag_off_returns_503() {
        let app = make_app(make_state_with_flag(false));
        let resp = post_record(app, json!({
            "originator_vasp": "SSSISSUER001",
            "beneficiary_vasp": "SSSMARKET001",
            "mint": "mint1",
            "amount": 1000,
            "threshold": 1000,
            "compliant": true
        })).await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    /// AUDIT3C-H1-T5: both VASPs forged → 422 on originator first
    #[tokio::test]
    async fn test_post_both_forged_returns_422_on_originator() {
        let app = make_app(make_state_with_flag(true));
        let resp = post_record(app, json!({
            "originator_vasp": "EVIL001",
            "beneficiary_vasp": "EVIL002",
            "mint": "mint1",
            "amount": 1000,
            "threshold": 1000,
            "compliant": false
        })).await;
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["error"].as_str().unwrap().contains("originator_vasp"));
    }

    /// AUDIT3C-H1-T6: devnet TESTVASP0001 works → 201
    #[tokio::test]
    async fn test_post_devnet_test_vasp_succeeds() {
        let app = make_app(make_state_with_flag(true));
        let resp = post_record(app, json!({
            "originator_vasp": "TESTVASP0001",
            "beneficiary_vasp": "TESTVASP0001",
            "mint": "devnetmint1",
            "amount": 9999,
            "threshold": 1000,
            "compliant": true
        })).await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    /// AUDIT3C-H1-T7: GET records returns record inserted via POST
    #[tokio::test]
    async fn test_get_records_returns_inserted() {
        let state = make_state_with_flag(true);
        // POST a record
        let app1 = make_app(state.clone());
        let post_resp = post_record(app1, json!({
            "originator_vasp": "SSSISSUER001",
            "beneficiary_vasp": "SSSMARKET001",
            "mint": "mint1",
            "amount": 777,
            "threshold": 1000,
            "compliant": true
        })).await;
        assert_eq!(post_resp.status(), StatusCode::CREATED);
        // GET and verify record is there
        let app2 = make_app(state);
        let get_resp = app2
            .oneshot(Request::builder().uri("/api/travel-rule/records").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(get_resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(get_resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["success"].as_bool().unwrap());
        let records = v["data"].as_array().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["originator_vasp"], "SSSISSUER001");
        assert_eq!(records[0]["amount"], 777);
    }
}
