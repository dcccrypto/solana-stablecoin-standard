//! SSS-129: ZK Credentials — selective disclosure compliance proofs
//!
//! Routes:
//!   GET  /api/zk-credentials/records     — list indexed CredentialRecords
//!   POST /api/zk-credentials/submit      — index a submitted ZK proof
//!   POST /api/zk-credentials/verify      — check compliance status for (mint, user, type)
//!   GET  /api/zk-credentials/registry    — list CredentialRegistry entries
//!   POST /api/zk-credentials/registry    — upsert a CredentialRegistry entry
//!
//! SSS-AUDIT2-C: All endpoints require FLAG_ZK_CREDENTIALS to be set in the
//! on-chain StablecoinConfig.  Returns 503 Service Unavailable when the flag
//! is off.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use tracing::{error, info};

use crate::feature_flags::FLAG_ZK_CREDENTIALS;
use crate::models::{
    ApiResponse, CredentialQuery, CredentialRecord, RegistryQuery, SubmitCredentialRequest,
    UpsertRegistryRequest, VerifyCredentialRequest, VerifyCredentialResponse,
};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// GET /api/zk-credentials/records
// ---------------------------------------------------------------------------

/// Return indexed CredentialRecords with optional filters.
///
/// Requires FLAG_ZK_CREDENTIALS (bit 8) in StablecoinConfig.feature_flags.
pub async fn list_credential_records(
    State(state): State<AppState>,
    Query(params): Query<CredentialQuery>,
) -> Result<Json<ApiResponse<Vec<CredentialRecord>>>, StatusCode> {
    // AUDIT2-C: gate on FLAG_ZK_CREDENTIALS
    if !state.feature_flags.is_set(FLAG_ZK_CREDENTIALS) {
        tracing::warn!("zk-credentials/records: FLAG_ZK_CREDENTIALS is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let limit = params.limit.unwrap_or(100).min(1000);
    let valid_only = params.valid_only.unwrap_or(false);

    let records = state
        .db
        .list_credential_records(
            params.user.as_deref(),
            params.mint.as_deref(),
            params.credential_type.as_deref(),
            valid_only,
            limit,
        )
        .map_err(|e| {
            error!("list_credential_records error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(records),
        error: None,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/zk-credentials/submit
// ---------------------------------------------------------------------------

/// Index a submitted ZK compliance proof.
///
/// In production, the on-chain verifier would have already validated the
/// Groth16 proof.  The backend indexes the resulting CredentialRecord PDA data.
/// The `proof_data` field is validated for non-empty base64 content (structural
/// check; full on-chain verification is done by the Solana program).
///
/// Requires FLAG_ZK_CREDENTIALS (bit 8) in StablecoinConfig.feature_flags.
pub async fn submit_credential(
    State(state): State<AppState>,
    Json(req): Json<SubmitCredentialRequest>,
) -> Result<Json<ApiResponse<CredentialRecord>>, StatusCode> {
    // AUDIT2-C: gate on FLAG_ZK_CREDENTIALS
    if !state.feature_flags.is_set(FLAG_ZK_CREDENTIALS) {
        tracing::warn!("zk-credentials/submit: FLAG_ZK_CREDENTIALS is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    // Structural validation
    if req.mint.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if req.user.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if req.credential_type.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if req.issuer_pubkey.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate proof_data is non-empty hex string representing Groth16 proof bytes.
    // Full on-chain verification is performed by the Solana program; we do a
    // structural check here (valid hex, non-empty).
    if req.proof_data.is_empty() || !req.proof_data.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            error: Some("proof_data must be a non-empty hex string".to_string()),
        }));
    }

    // Warn if not 512 hex chars (256 bytes Groth16 proof)
    if req.proof_data.len() != 512 {
        tracing::warn!(
            len = req.proof_data.len(),
            "proof_data hex length is not 512 chars (256 bytes) — expected Groth16 proof"
        );
    }

    let now_unix = Utc::now().timestamp();
    let expiry_secs = req.proof_expiry_seconds.unwrap_or(2_592_000) as i64; // 30 days default
    let verified_at = now_unix;
    let expires_at = now_unix + expiry_secs;

    let record = state
        .db
        .upsert_credential_record(
            &req.mint,
            &req.user,
            &req.credential_type,
            &req.issuer_pubkey,
            verified_at,
            expires_at,
            req.tx_signature.as_deref(),
            req.slot,
        )
        .map_err(|e| {
            error!("upsert_credential_record error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    info!(
        user = %req.user,
        mint = %req.mint,
        credential_type = %req.credential_type,
        expires_at,
        "ZK credential record indexed"
    );

    Ok(Json(ApiResponse {
        success: true,
        data: Some(record),
        error: None,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/zk-credentials/verify
// ---------------------------------------------------------------------------

/// Check whether a user has a valid (non-expired) CredentialRecord for the
/// requested credential type on the given mint.
///
/// Requires FLAG_ZK_CREDENTIALS (bit 8) in StablecoinConfig.feature_flags.
pub async fn verify_credential(
    State(state): State<AppState>,
    Json(req): Json<VerifyCredentialRequest>,
) -> Result<Json<VerifyCredentialResponse>, StatusCode> {
    // AUDIT2-C: gate on FLAG_ZK_CREDENTIALS
    if !state.feature_flags.is_set(FLAG_ZK_CREDENTIALS) {
        tracing::warn!("zk-credentials/verify: FLAG_ZK_CREDENTIALS is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    if req.mint.is_empty() || req.user.is_empty() || req.credential_type.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let record = state
        .db
        .get_credential_record(&req.mint, &req.user, &req.credential_type)
        .map_err(|e| {
            error!("get_credential_record error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let (is_valid, message, rec) = match record {
        Some(r) if r.is_valid => {
            let msg = format!(
                "User is compliant — credential expires at {}",
                chrono::DateTime::<Utc>::from_timestamp(r.expires_at, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| r.expires_at.to_string())
            );
            (true, msg, Some(r))
        }
        Some(r) => {
            let msg = format!(
                "Credential expired at {}",
                chrono::DateTime::<Utc>::from_timestamp(r.expires_at, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| r.expires_at.to_string())
            );
            (false, msg, Some(r))
        }
        None => (
            false,
            "No credential record found — proof submission required".to_string(),
            None,
        ),
    };

    Ok(Json(VerifyCredentialResponse {
        is_valid,
        record: rec,
        message,
    }))
}

// ---------------------------------------------------------------------------
// GET /api/zk-credentials/registry
// ---------------------------------------------------------------------------

/// Requires FLAG_ZK_CREDENTIALS (bit 8) in StablecoinConfig.feature_flags.
pub async fn list_registries(
    State(state): State<AppState>,
    Query(params): Query<RegistryQuery>,
) -> Result<Json<ApiResponse<Vec<crate::models::CredentialRegistry>>>, StatusCode> {
    // AUDIT2-C: gate on FLAG_ZK_CREDENTIALS
    if !state.feature_flags.is_set(FLAG_ZK_CREDENTIALS) {
        tracing::warn!("zk-credentials/registry GET: FLAG_ZK_CREDENTIALS is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let registries = state
        .db
        .list_credential_registries(params.mint.as_deref(), params.credential_type.as_deref())
        .map_err(|e| {
            error!("list_credential_registries error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ApiResponse {
        success: true,
        data: Some(registries),
        error: None,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/zk-credentials/registry
// ---------------------------------------------------------------------------

/// Requires FLAG_ZK_CREDENTIALS (bit 8) in StablecoinConfig.feature_flags.
pub async fn upsert_registry(
    State(state): State<AppState>,
    Json(req): Json<UpsertRegistryRequest>,
) -> Result<Json<ApiResponse<crate::models::CredentialRegistry>>, StatusCode> {
    // AUDIT2-C: gate on FLAG_ZK_CREDENTIALS
    if !state.feature_flags.is_set(FLAG_ZK_CREDENTIALS) {
        tracing::warn!("zk-credentials/registry POST: FLAG_ZK_CREDENTIALS is not set — returning 503");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    if req.mint.is_empty() || req.credential_type.is_empty() || req.issuer_pubkey.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    // Validate merkle_root is 64 hex chars (32 bytes)
    if req.merkle_root.len() != 64 || !req.merkle_root.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            error: Some("merkle_root must be 64 hex characters (32 bytes)".to_string()),
        }));
    }

    let expiry = req.proof_expiry_seconds.unwrap_or(2_592_000);

    let reg = state
        .db
        .upsert_credential_registry(
            &req.mint,
            &req.credential_type,
            &req.issuer_pubkey,
            &req.merkle_root,
            expiry,
        )
        .map_err(|e| {
            error!("upsert_credential_registry error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    info!(
        mint = %req.mint,
        credential_type = %req.credential_type,
        merkle_root = %req.merkle_root,
        "CredentialRegistry upserted"
    );

    Ok(Json(ApiResponse {
        success: true,
        data: Some(reg),
        error: None,
    }))
}
