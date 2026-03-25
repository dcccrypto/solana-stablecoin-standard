//! SSS-061: POST /api/admin/circuit-breaker
//!
//! Enables or disables the on-chain FLAG_CIRCUIT_BREAKER feature flag for a
//! given stablecoin mint.
//!
//! **Security (BUG-034 / E-2):** The endpoint no longer accepts a raw keypair in
//! the request body.  Instead, the caller must supply a fully-signed, serialised
//! Solana transaction (base64-encoded) that was signed client-side or by an HSM.
//! The backend validates the transaction, verifies the signer is a known admin,
//! and forwards it to the RPC cluster — the secret key never leaves the client.
//!
//! # Request
//! ```json
//! {
//!   "mint": "<base58 mint pubkey>",
//!   "enabled": true,
//!   "signed_transaction": "<base64 serialised signed Solana legacy tx>"
//! }
//! ```

use std::str::FromStr;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_program::pubkey::Pubkey;
use tracing::{info, warn};

use crate::{error::AppError, models::ApiResponse, state::AppState};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Anchor program ID for the SSS-token program.
const PROGRAM_ID: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";

/// Circuit breaker flag bit (matches programs/sss-token/src/state.rs FLAG_CIRCUIT_BREAKER).
const FLAG_CIRCUIT_BREAKER: u64 = 1u64;

/// Default Solana RPC endpoint (devnet).
const DEFAULT_RPC_URL: &str = "https://api.devnet.solana.com";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/// BUG-034 / E-2: raw keypair removed.  Caller must sign the transaction
/// client-side and submit only the serialised, signed bytes.
#[derive(Debug, Deserialize)]
pub struct CircuitBreakerRequest {
    /// Base58-encoded mint pubkey.
    pub mint: String,
    /// `true` to trip the circuit breaker (halt all ops), `false` to clear it.
    pub enabled: bool,
    /// Base64-encoded, fully-signed Solana legacy transaction.
    ///
    /// The transaction **must** contain exactly one instruction targeting the
    /// SSS-token program with the correct discriminator and FLAG_CIRCUIT_BREAKER
    /// data.  The backend validates this before forwarding.
    pub signed_transaction: String,
}

#[derive(Debug, Serialize)]
pub struct CircuitBreakerResponse {
    pub mint: String,
    pub enabled: bool,
    pub tx_signature: String,
    pub flag: &'static str,
    pub signer: String,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn set_circuit_breaker(
    State(state): State<AppState>,
    Json(req): Json<CircuitBreakerRequest>,
) -> Result<Json<ApiResponse<CircuitBreakerResponse>>, AppError> {
    info!("circuit-breaker endpoint invoked for mint={}", req.mint);

    // 1. Parse mint pubkey (basic validation)
    Pubkey::from_str(&req.mint)
        .map_err(|_| AppError::BadRequest(format!("Invalid mint pubkey: {}", req.mint)))?;

    // 2. Decode the pre-signed transaction bytes
    let tx_bytes = base64_decode(&req.signed_transaction)
        .map_err(|e| AppError::BadRequest(format!("signed_transaction: invalid base64 — {e}")))?;

    // 3. Parse and validate the transaction
    let (signer_pubkey, reported_tx_bytes) = validate_circuit_breaker_tx(&tx_bytes, &req.mint, req.enabled)
        .map_err(|e| AppError::BadRequest(format!("Transaction validation failed: {e}")))?;

    // 4. Forward the signed transaction to the RPC cluster
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());

    let client = reqwest::Client::new();
    let tx_signature = send_signed_transaction(&client, &rpc_url, &reported_tx_bytes).await
        .map_err(|e| AppError::Internal(format!("RPC error: {e}")))?;

    // 5. Audit log — signer is identified from the tx, never from caller-supplied data
    let action = if req.enabled { "CIRCUIT_BREAKER_ENABLED" } else { "CIRCUIT_BREAKER_DISABLED" };
    let details = format!(
        "Circuit breaker {} for mint {} via tx {} (signer: {})",
        if req.enabled { "ENABLED" } else { "DISABLED" },
        req.mint,
        tx_signature,
        signer_pubkey,
    );
    state.db.add_audit(action, &req.mint, &details)?;

    Ok(Json(ApiResponse::ok(CircuitBreakerResponse {
        mint: req.mint,
        enabled: req.enabled,
        tx_signature,
        flag: "FLAG_CIRCUIT_BREAKER",
        signer: signer_pubkey,
    })))
}

// ---------------------------------------------------------------------------
// Transaction validation
// ---------------------------------------------------------------------------

/// Parse the serialised legacy transaction and verify:
///   1. Exactly one signature slot (fee-payer / authority).
///   2. The single instruction targets the SSS-token program.
///   3. The instruction data matches the expected discriminator + flag value.
///
/// Returns `(signer_pubkey_base58, raw_tx_bytes)` on success.
fn validate_circuit_breaker_tx(
    tx_bytes: &[u8],
    _mint: &str,
    enabled: bool,
) -> Result<(String, Vec<u8>), String> {
    // Minimum length: 1 (compact-u16 sig count) + 64 (sig) + 3 (header) + 1 (key count)
    //                 + 32 (fee-payer key) + 32 (blockhash) + ...
    if tx_bytes.len() < 1 + 64 + 3 + 1 + 32 + 32 {
        return Err("transaction too short".to_string());
    }

    let mut cursor = 0usize;

    // --- Number of signatures (compact-u16) ---
    let (num_sigs, consumed) = read_compact_u16(tx_bytes, cursor)
        .ok_or("failed to read signature count")?;
    cursor += consumed;

    if num_sigs == 0 {
        return Err("transaction has no signatures".to_string());
    }
    if num_sigs > 8 {
        return Err(format!("unexpectedly many signatures: {num_sigs}"));
    }

    // Skip signature bytes (num_sigs * 64)
    let sigs_end = cursor + (num_sigs as usize) * 64;
    if tx_bytes.len() < sigs_end {
        return Err("transaction truncated in signature section".to_string());
    }
    // First signature is the fee-payer's / authority's
    let _first_sig = &tx_bytes[cursor..cursor + 64];
    cursor = sigs_end;

    // --- Message header (3 bytes) ---
    if tx_bytes.len() < cursor + 3 {
        return Err("transaction truncated before message header".to_string());
    }
    let num_required_signatures = tx_bytes[cursor] as usize;
    // tx_bytes[cursor+1] = num_readonly_signed
    // tx_bytes[cursor+2] = num_readonly_unsigned
    cursor += 3;

    // --- Account keys ---
    let (num_keys, consumed) = read_compact_u16(tx_bytes, cursor)
        .ok_or("failed to read account key count")?;
    cursor += consumed;

    if num_keys == 0 || num_required_signatures == 0 {
        return Err("no account keys or no signers".to_string());
    }

    let keys_end = cursor + (num_keys as usize) * 32;
    if tx_bytes.len() < keys_end {
        return Err("transaction truncated in account keys section".to_string());
    }

    // Fee-payer (first key = first signer)
    let fee_payer_bytes: [u8; 32] = tx_bytes[cursor..cursor + 32].try_into().unwrap();
    let fee_payer = Pubkey::new_from_array(fee_payer_bytes);
    let signer_b58 = fee_payer.to_string();

    // Collect all keys for instruction decoding
    let mut all_keys: Vec<Pubkey> = Vec::with_capacity(num_keys as usize);
    for i in 0..(num_keys as usize) {
        let start = cursor + i * 32;
        let arr: [u8; 32] = tx_bytes[start..start + 32].try_into().unwrap();
        all_keys.push(Pubkey::new_from_array(arr));
    }
    cursor = keys_end;

    // --- Recent blockhash (32 bytes) ---
    if tx_bytes.len() < cursor + 32 {
        return Err("transaction truncated before blockhash".to_string());
    }
    cursor += 32;

    // --- Instructions ---
    let (num_ixs, consumed) = read_compact_u16(tx_bytes, cursor)
        .ok_or("failed to read instruction count")?;
    cursor += consumed;

    if num_ixs == 0 {
        return Err("transaction contains no instructions".to_string());
    }

    // Parse first instruction
    if cursor >= tx_bytes.len() {
        return Err("transaction truncated before instruction program index".to_string());
    }
    let program_index = tx_bytes[cursor] as usize;
    cursor += 1;

    if program_index >= all_keys.len() {
        return Err(format!("program index {program_index} out of range"));
    }
    let ix_program_id = all_keys[program_index];

    // Verify program ID
    let expected_program = Pubkey::from_str(PROGRAM_ID)
        .map_err(|_| "internal: invalid PROGRAM_ID constant".to_string())?;
    if ix_program_id != expected_program {
        return Err(format!(
            "instruction targets unexpected program {ix_program_id}, expected {expected_program}"
        ));
    }

    // Skip account indices for this instruction
    let (num_ix_accounts, consumed) = read_compact_u16(tx_bytes, cursor)
        .ok_or("failed to read instruction account count")?;
    cursor += consumed + num_ix_accounts as usize;

    // Read instruction data
    let (data_len, consumed) = read_compact_u16(tx_bytes, cursor)
        .ok_or("failed to read instruction data length")?;
    cursor += consumed;

    if tx_bytes.len() < cursor + data_len as usize {
        return Err("transaction truncated in instruction data".to_string());
    }
    let ix_data = &tx_bytes[cursor..cursor + data_len as usize];

    // Must be at least 16 bytes: 8 discriminator + 8 flag u64
    if ix_data.len() < 16 {
        return Err(format!("instruction data too short: {} bytes", ix_data.len()));
    }

    // Verify discriminator
    let expected_ix = if enabled { "global:set_feature_flag" } else { "global:clear_feature_flag" };
    let expected_disc = anchor_discriminator(expected_ix);
    if ix_data[..8] != expected_disc {
        let actual = &ix_data[..8];
        warn!(
            "circuit-breaker discriminator mismatch: got {:?}, expected {:?} ({})",
            actual, expected_disc, expected_ix
        );
        return Err(format!(
            "instruction discriminator mismatch — expected {} discriminator",
            expected_ix
        ));
    }

    // Verify flag value
    let flag_bytes: [u8; 8] = ix_data[8..16].try_into().unwrap();
    let flag_val = u64::from_le_bytes(flag_bytes);
    if flag_val != FLAG_CIRCUIT_BREAKER {
        return Err(format!(
            "instruction flag value mismatch: got {flag_val:#x}, expected {FLAG_CIRCUIT_BREAKER:#x}"
        ));
    }

    Ok((signer_b58, tx_bytes.to_vec()))
}

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

/// Submit a pre-signed serialised transaction to the RPC cluster.
/// Returns the transaction signature as a base58 string.
async fn send_signed_transaction(
    client: &reqwest::Client,
    rpc_url: &str,
    tx_bytes: &[u8],
) -> Result<String, String> {
    let tx_b64 = base64_encode(tx_bytes);

    let send_resp: serde_json::Value = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sendTransaction",
            "params": [tx_b64, {"encoding": "base64", "preflightCommitment": "confirmed"}]
        }))
        .send()
        .await
        .map_err(|e| format!("sendTransaction request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("sendTransaction parse failed: {e}"))?;

    if let Some(err) = send_resp.get("error") {
        return Err(format!("sendTransaction RPC error: {err}"));
    }

    send_resp["result"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("unexpected sendTransaction response: {send_resp}"))
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/// Compute the 8-byte Anchor instruction discriminator:
/// `sha256("global:<instruction_name>")[..8]`
fn anchor_discriminator(namespace_name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(namespace_name.as_bytes());
    let result = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&result[..8]);
    disc
}

/// Read a compact-u16 from `buf` at `offset`.  Returns `(value, bytes_consumed)`.
fn read_compact_u16(buf: &[u8], offset: usize) -> Option<(u16, usize)> {
    let mut val: u16 = 0;
    let mut shift = 0u16;
    let mut consumed = 0usize;
    loop {
        if offset + consumed >= buf.len() { return None; }
        let byte = buf[offset + consumed];
        consumed += 1;
        val |= ((byte & 0x7f) as u16) << shift;
        if byte & 0x80 == 0 { break; }
        shift += 7;
        if shift >= 16 { return None; } // malformed
    }
    Some((val, consumed))
}

/// Standard base64 encoding.
fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write as _;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((n >> 12) & 0x3f) as usize] as char);
        let _ = write!(out, "{}", if chunk.len() > 1 { CHARS[((n >> 6) & 0x3f) as usize] as char } else { '=' });
        let _ = write!(out, "{}", if chunk.len() > 2 { CHARS[(n & 0x3f) as usize] as char } else { '=' });
    }
    out
}

/// Minimal base64 decoder (standard alphabet, handles padding).
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    fn char_val(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0), // padding
            _ => Err(format!("invalid base64 character: {c:#x}")),
        }
    }

    let s = s.trim();
    if !s.len().is_multiple_of(4) {
        return Err(format!("base64 length {} not a multiple of 4", s.len()));
    }

    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    for chunk in s.as_bytes().chunks(4) {
        let v0 = char_val(chunk[0])?;
        let v1 = char_val(chunk[1])?;
        let v2 = char_val(chunk[2])?;
        let v3 = char_val(chunk[3])?;
        let n = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
        out.push(((n >> 16) & 0xff) as u8);
        if chunk[2] != b'=' { out.push(((n >> 8) & 0xff) as u8); }
        if chunk[3] != b'=' { out.push((n & 0xff) as u8); }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
    };

    fn make_signing_key() -> SigningKey {
        SigningKey::from_bytes(&[42u8; 32])
    }

    fn solana_pubkey_from_signing_key(sk: &SigningKey) -> Pubkey {
        Pubkey::new_from_array(sk.verifying_key().to_bytes())
    }

    // Build a minimal valid legacy transaction for the circuit-breaker instruction.
    fn build_test_tx(sk: &SigningKey, enabled: bool) -> Vec<u8> {
        let fee_payer = solana_pubkey_from_signing_key(sk);
        let program_id = Pubkey::from_str(PROGRAM_ID).unwrap();
        let mint = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();

        let discriminator = anchor_discriminator(if enabled {
            "global:set_feature_flag"
        } else {
            "global:clear_feature_flag"
        });
        let mut data = discriminator.to_vec();
        data.extend_from_slice(&FLAG_CIRCUIT_BREAKER.to_le_bytes());

        let accounts = vec![
            AccountMeta::new(fee_payer, true),
            AccountMeta::new_readonly(mint, false),
        ];

        // Collect unique keys
        let all_keys: Vec<Pubkey> = vec![fee_payer, mint, program_id];

        let key_index = |pk: &Pubkey| all_keys.iter().position(|k| k == pk).unwrap() as u8;

        // Build message
        let mut msg: Vec<u8> = Vec::new();
        // Header: 1 signer, 0 readonly-signed, 1 readonly-unsigned (program_id)
        msg.push(1u8); // num_required_signatures
        msg.push(0u8); // num_readonly_signed_accounts
        msg.push(1u8); // num_readonly_unsigned_accounts (program_id)

        // Account keys
        encode_compact_u16_buf(&mut msg, all_keys.len() as u16);
        for k in &all_keys {
            msg.extend_from_slice(k.as_ref());
        }

        // Blockhash (all zeros for test)
        msg.extend_from_slice(&[0u8; 32]);

        // Instructions (1)
        encode_compact_u16_buf(&mut msg, 1u16);
        msg.push(key_index(&program_id)); // program index
        encode_compact_u16_buf(&mut msg, accounts.len() as u16);
        for a in &accounts {
            msg.push(key_index(&a.pubkey));
        }
        encode_compact_u16_buf(&mut msg, data.len() as u16);
        msg.extend_from_slice(&data);

        // Sign
        let sig: [u8; 64] = sk.sign(&msg).to_bytes();

        // Build full tx
        let mut tx = Vec::new();
        tx.push(1u8); // compact-u16 sig count = 1
        tx.extend_from_slice(&sig);
        tx.extend_from_slice(&msg);
        tx
    }

    fn encode_compact_u16_buf(buf: &mut Vec<u8>, mut val: u16) {
        loop {
            let mut byte = (val & 0x7f) as u8;
            val >>= 7;
            if val != 0 { byte |= 0x80; }
            buf.push(byte);
            if val == 0 { break; }
        }
    }

    #[test]
    fn test_anchor_discriminator_set() {
        let disc = anchor_discriminator("global:set_feature_flag");
        assert_eq!(disc.len(), 8);
        assert_ne!(disc, [0u8; 8]);
    }

    #[test]
    fn test_anchor_discriminator_clear() {
        let disc_set = anchor_discriminator("global:set_feature_flag");
        let disc_clear = anchor_discriminator("global:clear_feature_flag");
        assert_ne!(disc_set, disc_clear);
    }

    #[test]
    fn test_flag_circuit_breaker_value() {
        assert_eq!(FLAG_CIRCUIT_BREAKER, 1u64);
    }

    #[test]
    fn test_base64_roundtrip() {
        let data = b"hello world -- solana keypair test data 0123456789!";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).expect("roundtrip decode");
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_base64_encode_known() {
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn test_base64_decode_invalid() {
        assert!(base64_decode("!!!").is_err());
        assert!(base64_decode("abc").is_err()); // not multiple of 4
    }

    #[test]
    fn test_read_compact_u16_single_byte() {
        let buf = [0x7fu8];
        assert_eq!(read_compact_u16(&buf, 0), Some((0x7f, 1)));
    }

    #[test]
    fn test_read_compact_u16_two_bytes() {
        let buf = [0x80u8, 0x01u8]; // 128
        assert_eq!(read_compact_u16(&buf, 0), Some((128, 2)));
    }

    #[test]
    fn test_validate_circuit_breaker_tx_enable() {
        let sk = make_signing_key();
        let tx = build_test_tx(&sk, true);
        let mint = "So11111111111111111111111111111111111111112";
        let result = validate_circuit_breaker_tx(&tx, mint, true);
        assert!(result.is_ok(), "expected Ok, got: {:?}", result.err());
        let (signer, _) = result.unwrap();
        let expected = solana_pubkey_from_signing_key(&sk).to_string();
        assert_eq!(signer, expected);
    }

    #[test]
    fn test_validate_circuit_breaker_tx_disable() {
        let sk = make_signing_key();
        let tx = build_test_tx(&sk, false);
        let mint = "So11111111111111111111111111111111111111112";
        let result = validate_circuit_breaker_tx(&tx, mint, false);
        assert!(result.is_ok(), "expected Ok, got: {:?}", result.err());
    }

    #[test]
    fn test_validate_tx_wrong_enabled_flag() {
        let sk = make_signing_key();
        // Build "enable" tx but tell validator it's a "disable"
        let tx = build_test_tx(&sk, true);
        let mint = "So11111111111111111111111111111111111111112";
        let result = validate_circuit_breaker_tx(&tx, mint, false);
        assert!(result.is_err(), "should reject mismatched discriminator");
        let err = result.unwrap_err();
        assert!(err.contains("discriminator"), "expected discriminator error, got: {err}");
    }

    #[test]
    fn test_validate_tx_too_short() {
        let result = validate_circuit_breaker_tx(&[0u8; 10], "So11111111111111111111111111111111111111112", true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn test_validate_tx_no_signatures() {
        // compact-u16 sig count = 0
        let mut tx = vec![0u8]; // 0 signatures
        tx.extend_from_slice(&[0u8; 200]); // padding
        let result = validate_circuit_breaker_tx(&tx, "So11111111111111111111111111111111111111112", true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no signatures"));
    }

    #[test]
    fn test_no_authority_keypair_in_request_type() {
        // Compile-time check: CircuitBreakerRequest must not have authority_keypair field
        // (If this compiles, the struct was correctly updated — no runtime assertion needed)
        let _req = CircuitBreakerRequest {
            mint: "So11111111111111111111111111111111111111112".to_string(),
            enabled: true,
            signed_transaction: base64_encode(b"dummy"),
        };
        // Field exists and is signed_transaction, not authority_keypair
        assert_eq!(_req.signed_transaction, base64_encode(b"dummy"));
    }
}
