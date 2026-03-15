//! SSS-061: POST /api/admin/circuit-breaker
//!
//! Enables or disables the on-chain FLAG_CIRCUIT_BREAKER feature flag for a
//! given stablecoin mint.  The caller supplies the authority keypair in the
//! request body; the backend signs and broadcasts the transaction.
//!
//! ⚠️  Security note: accepting a raw keypair over HTTP is only appropriate for
//! admin tooling on a secured network.  In production, gate this endpoint with
//! TLS and consider using a hardware signer or HSM instead.

use std::str::FromStr;

use axum::{extract::State, Json};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use tracing::warn;

use crate::{error::AppError, models::ApiResponse, state::AppState};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Anchor program ID for the SSS-token program.
const PROGRAM_ID: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";

/// Token-2022 program ID.
const TOKEN_2022_PROGRAM_ID: &str = "TokenzQdBNbLqP5VEhdkAS6EPFL8hWKpJvXjz8GnBq";

/// Circuit breaker flag bit (matches programs/sss-token/src/state.rs FLAG_CIRCUIT_BREAKER).
const FLAG_CIRCUIT_BREAKER: u64 = 1u64;

/// Default Solana RPC endpoint (devnet).
const DEFAULT_RPC_URL: &str = "https://api.devnet.solana.com";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CircuitBreakerRequest {
    /// Base58-encoded mint pubkey.
    pub mint: String,
    /// `true` to trip the circuit breaker (halt all ops), `false` to clear it.
    pub enabled: bool,
    /// Authority keypair.  Two formats accepted:
    ///   1. Base58-encoded 64-byte keypair string (as exported by `solana-keygen`).
    ///   2. JSON array of 64 u8 values.
    pub authority_keypair: AuthorityKeypair,
}

/// Flexible keypair input — base58 string or byte array.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum AuthorityKeypair {
    Base58(String),
    Bytes(Vec<u8>),
}

#[derive(Debug, Serialize)]
pub struct CircuitBreakerResponse {
    pub mint: String,
    pub enabled: bool,
    pub tx_signature: String,
    pub flag: &'static str,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn set_circuit_breaker(
    State(state): State<AppState>,
    Json(req): Json<CircuitBreakerRequest>,
) -> Result<Json<ApiResponse<CircuitBreakerResponse>>, AppError> {
    warn!("circuit-breaker endpoint invoked — keypair transmitted in request body");

    // 1. Parse mint pubkey
    let mint_pubkey = Pubkey::from_str(&req.mint)
        .map_err(|_| AppError::BadRequest(format!("Invalid mint pubkey: {}", req.mint)))?;

    // 2. Parse authority keypair → 64-byte secret key
    let keypair_bytes: [u8; 64] = parse_keypair(&req.authority_keypair)?;
    let signing_key = SigningKey::from_keypair_bytes(&keypair_bytes)
        .map_err(|e| AppError::BadRequest(format!("Invalid keypair: {e}")))?;
    let authority_pubkey = solana_pubkey_from_ed25519(&signing_key);

    // 3. Compute config PDA: seeds = ["stablecoin-config", mint]
    let program_id = Pubkey::from_str(PROGRAM_ID)
        .map_err(|_| AppError::Internal("Invalid program ID".to_string()))?;
    let (config_pda, _bump) = Pubkey::find_program_address(
        &[b"stablecoin-config", mint_pubkey.as_ref()],
        &program_id,
    );

    let token_program_id = Pubkey::from_str(TOKEN_2022_PROGRAM_ID)
        .map_err(|_| AppError::Internal("Invalid token-2022 program ID".to_string()))?;

    // 4. Build Anchor instruction
    let discriminator = anchor_discriminator(if req.enabled {
        "global:set_feature_flag"
    } else {
        "global:clear_feature_flag"
    });

    let mut data = discriminator.to_vec();
    // Borsh-serialize the u64 flag argument (little-endian, 8 bytes)
    data.extend_from_slice(&FLAG_CIRCUIT_BREAKER.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(authority_pubkey, true),  // authority (signer)
        AccountMeta::new(config_pda, false),                 // config (mut)
        AccountMeta::new_readonly(mint_pubkey, false),       // mint
        AccountMeta::new_readonly(token_program_id, false),  // token_program
    ];

    let instruction = Instruction {
        program_id,
        accounts,
        data,
    };

    // 5. Get recent blockhash and send transaction via JSON-RPC
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());

    let client = reqwest::Client::new();
    let tx_signature = send_transaction(&client, &rpc_url, &signing_key, &authority_pubkey, instruction).await
        .map_err(|e| AppError::Internal(format!("RPC error: {e}")))?;

    // 6. Audit log
    let action = if req.enabled { "CIRCUIT_BREAKER_ENABLED" } else { "CIRCUIT_BREAKER_DISABLED" };
    let details = format!(
        "Circuit breaker {} for mint {} via tx {}",
        if req.enabled { "ENABLED" } else { "DISABLED" },
        req.mint,
        tx_signature,
    );
    state.db.add_audit(action, &req.mint, &details)?;

    Ok(Json(ApiResponse::ok(CircuitBreakerResponse {
        mint: req.mint,
        enabled: req.enabled,
        tx_signature,
        flag: "FLAG_CIRCUIT_BREAKER",
    })))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a keypair from either base58 string or byte vec → [u8; 64].
fn parse_keypair(kp: &AuthorityKeypair) -> Result<[u8; 64], AppError> {
    let bytes = match kp {
        AuthorityKeypair::Base58(s) => {
            bs58::decode(s)
                .into_vec()
                .map_err(|_| AppError::BadRequest("authority_keypair: invalid base58".to_string()))?
        }
        AuthorityKeypair::Bytes(v) => v.clone(),
    };
    if bytes.len() != 64 {
        return Err(AppError::BadRequest(format!(
            "authority_keypair must be 64 bytes, got {}",
            bytes.len()
        )));
    }
    let mut arr = [0u8; 64];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Derive the Solana pubkey (32-byte compressed Edwards point) from an ed25519 SigningKey.
fn solana_pubkey_from_ed25519(sk: &SigningKey) -> Pubkey {
    let vk = sk.verifying_key();
    Pubkey::new_from_array(vk.to_bytes())
}

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

/// Fetch a recent blockhash, build + sign a transaction, and broadcast it.
/// Returns the transaction signature as a base58 string.
async fn send_transaction(
    client: &reqwest::Client,
    rpc_url: &str,
    signing_key: &SigningKey,
    authority: &Pubkey,
    instruction: Instruction,
) -> Result<String, String> {
    // --- Get recent blockhash ---
    let bh_resp: serde_json::Value = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getLatestBlockhash",
            "params": [{"commitment": "confirmed"}]
        }))
        .send()
        .await
        .map_err(|e| format!("getLatestBlockhash request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("getLatestBlockhash parse failed: {e}"))?;

    let blockhash_str = bh_resp["result"]["value"]["blockhash"]
        .as_str()
        .ok_or("missing blockhash in RPC response")?;

    let blockhash_bytes = bs58::decode(blockhash_str)
        .into_vec()
        .map_err(|_| "invalid blockhash base58")?;
    if blockhash_bytes.len() != 32 {
        return Err(format!("unexpected blockhash length: {}", blockhash_bytes.len()));
    }

    // --- Build serialized transaction ---
    // Solana legacy transaction message layout (manual encoding):
    //   header (3 bytes) | account_keys | recent_blockhash | instructions
    let message_bytes = build_message(authority, &instruction, &blockhash_bytes)?;

    // --- Sign ---
    let sig_bytes: [u8; 64] = signing_key.sign(&message_bytes).to_bytes();

    // --- Serialize full transaction: [num_signatures(compact u16)] + sig + message ---
    let mut tx_bytes: Vec<u8> = Vec::new();
    // compact-u16 for 1 signature = 0x01
    tx_bytes.push(1u8);
    tx_bytes.extend_from_slice(&sig_bytes);
    tx_bytes.extend_from_slice(&message_bytes);

    let tx_b64 = base64_encode(&tx_bytes);

    // --- Send ---
    let send_resp: serde_json::Value = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
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

/// Build a Solana legacy transaction message (manual binary encoding).
fn build_message(
    fee_payer: &Pubkey,
    ix: &Instruction,
    recent_blockhash: &[u8],
) -> Result<Vec<u8>, String> {
    // Collect unique account keys: fee_payer first, then program accounts in order
    let mut keys: Vec<Pubkey> = vec![*fee_payer];
    let mut writable: Vec<bool> = vec![true];
    let mut signer: Vec<bool> = vec![true];

    for meta in &ix.accounts {
        if let Some(pos) = keys.iter().position(|k| k == &meta.pubkey) {
            // Already present — merge flags (OR)
            if meta.is_writable { writable[pos] = true; }
            if meta.is_signer { signer[pos] = true; }
        } else {
            keys.push(meta.pubkey);
            writable.push(meta.is_writable);
            signer.push(meta.is_signer);
        }
    }
    // Program ID
    if !keys.contains(&ix.program_id) {
        keys.push(ix.program_id);
        writable.push(false);
        signer.push(false);
    }

    // Count signers and writables (must be at the front for the header)
    // Solana header: [num_required_signatures, num_readonly_signed, num_readonly_unsigned]
    let num_signers = signer.iter().filter(|&&s| s).count() as u8;
    let num_readonly_signed = signer.iter().zip(writable.iter())
        .filter(|(&s, &w)| s && !w).count() as u8;
    let num_readonly_unsigned = signer.iter().zip(writable.iter())
        .filter(|(&s, &w)| !s && !w).count() as u8;

    // Sort keys: signers first, then non-signers; within each group writables first
    let mut indexed: Vec<(usize, Pubkey, bool, bool)> = keys.iter().enumerate()
        .map(|(i, k)| (i, *k, writable[i], signer[i]))
        .collect();
    indexed.sort_by(|a, b| {
        // signers before non-signers
        b.3.cmp(&a.3)
            // within same signer group: writable before readonly
            .then(b.2.cmp(&a.2))
    });

    let sorted_keys: Vec<Pubkey> = indexed.iter().map(|x| x.1).collect();

    // Rebuild account index map
    let key_index = |pk: &Pubkey| -> Result<u8, String> {
        sorted_keys.iter().position(|k| k == pk)
            .map(|i| i as u8)
            .ok_or_else(|| format!("pubkey {pk} not in account list"))
    };

    // Instruction accounts (indices into sorted_keys)
    let ix_accounts: Vec<u8> = ix.accounts.iter()
        .map(|m| key_index(&m.pubkey))
        .collect::<Result<Vec<_>, _>>()?;
    let program_index = key_index(&ix.program_id)?;

    // Encode message
    let mut msg: Vec<u8> = Vec::new();

    // Header
    msg.push(num_signers);
    msg.push(num_readonly_signed);
    msg.push(num_readonly_unsigned);

    // Account keys (compact-u16 count + 32-byte keys)
    encode_compact_u16(&mut msg, sorted_keys.len() as u16);
    for k in &sorted_keys {
        msg.extend_from_slice(k.as_ref());
    }

    // Recent blockhash (32 bytes)
    msg.extend_from_slice(recent_blockhash);

    // Instructions (compact-u16 count = 1)
    encode_compact_u16(&mut msg, 1u16);
    msg.push(program_index);
    encode_compact_u16(&mut msg, ix_accounts.len() as u16);
    msg.extend_from_slice(&ix_accounts);
    encode_compact_u16(&mut msg, ix.data.len() as u16);
    msg.extend_from_slice(&ix.data);

    Ok(msg)
}

/// Encode a u16 as a Solana compact-u16 (1–3 bytes).
fn encode_compact_u16(buf: &mut Vec<u8>, mut val: u16) {
    loop {
        let mut byte = (val & 0x7f) as u8;
        val >>= 7;
        if val != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if val == 0 { break; }
    }
}

/// Standard base64 encoding (no padding stripping — RPC expects standard).
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn random_signing_key() -> SigningKey {
        use ed25519_dalek::SigningKey;
        // Use fixed seed for deterministic tests
        SigningKey::from_bytes(&[42u8; 32])
    }

    #[test]
    fn test_anchor_discriminator_set() {
        let disc = anchor_discriminator("global:set_feature_flag");
        // SHA-256("global:set_feature_flag")[..8] — just verify it's 8 bytes and non-zero
        assert_eq!(disc.len(), 8);
        assert_ne!(disc, [0u8; 8]);
    }

    #[test]
    fn test_anchor_discriminator_clear() {
        let disc_set = anchor_discriminator("global:set_feature_flag");
        let disc_clear = anchor_discriminator("global:clear_feature_flag");
        // Different instructions → different discriminators
        assert_ne!(disc_set, disc_clear);
    }

    #[test]
    fn test_parse_keypair_bytes_valid() {
        let kp = AuthorityKeypair::Bytes(vec![0u8; 64]);
        let result = parse_keypair(&kp);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), [0u8; 64]);
    }

    #[test]
    fn test_parse_keypair_bytes_wrong_length() {
        let kp = AuthorityKeypair::Bytes(vec![0u8; 32]);
        let result = parse_keypair(&kp);
        assert!(result.is_err());
        let err = format!("{:?}", result.unwrap_err());
        assert!(err.contains("64 bytes"), "error should mention 64 bytes: {err}");
    }

    #[test]
    fn test_parse_keypair_base58_valid() {
        // Generate a known 64-byte keypair and encode as base58
        let bytes = [1u8; 64];
        let encoded = bs58::encode(&bytes).into_string();
        let kp = AuthorityKeypair::Base58(encoded);
        let result = parse_keypair(&kp);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), [1u8; 64]);
    }

    #[test]
    fn test_parse_keypair_base58_invalid() {
        let kp = AuthorityKeypair::Base58("not_valid_base58!@#".to_string());
        let result = parse_keypair(&kp);
        assert!(result.is_err());
    }

    #[test]
    fn test_solana_pubkey_from_ed25519() {
        let sk = random_signing_key();
        let pk = solana_pubkey_from_ed25519(&sk);
        // Pubkey should be 32 bytes and match the verifying key
        assert_eq!(pk.to_bytes(), sk.verifying_key().to_bytes());
    }

    #[test]
    fn test_flag_circuit_breaker_value() {
        // Must match programs/sss-token/src/state.rs FLAG_CIRCUIT_BREAKER = 1 << 0
        assert_eq!(FLAG_CIRCUIT_BREAKER, 1u64);
    }

    #[test]
    fn test_instruction_data_set_flag() {
        let disc = anchor_discriminator("global:set_feature_flag");
        let mut data = disc.to_vec();
        data.extend_from_slice(&FLAG_CIRCUIT_BREAKER.to_le_bytes());
        assert_eq!(data.len(), 16); // 8-byte disc + 8-byte u64
        // Flag bytes should be [1, 0, 0, 0, 0, 0, 0, 0] (little-endian 1)
        assert_eq!(&data[8..], &[1, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn test_instruction_data_clear_flag() {
        let disc = anchor_discriminator("global:clear_feature_flag");
        let mut data = disc.to_vec();
        data.extend_from_slice(&FLAG_CIRCUIT_BREAKER.to_le_bytes());
        assert_eq!(data.len(), 16);
        assert_eq!(&data[8..], &[1, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn test_encode_compact_u16_single_byte() {
        let mut buf = Vec::new();
        encode_compact_u16(&mut buf, 0x7f);
        assert_eq!(buf, vec![0x7f]);
    }

    #[test]
    fn test_encode_compact_u16_two_bytes() {
        let mut buf = Vec::new();
        encode_compact_u16(&mut buf, 128);
        // 128 = 0x80 → compact: [0x80, 0x01]
        assert_eq!(buf, vec![0x80, 0x01]);
    }

    #[test]
    fn test_base64_encode_known() {
        // "Man" → "TWFu"
        assert_eq!(base64_encode(b"Man"), "TWFu");
        // empty
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn test_build_message_structure() {
        let sk = random_signing_key();
        let fee_payer = solana_pubkey_from_ed25519(&sk);
        let program_id = Pubkey::from_str(PROGRAM_ID).unwrap();
        let blockhash = [0u8; 32];

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(fee_payer, true),
                AccountMeta::new_readonly(program_id, false),
            ],
            data: vec![1, 2, 3, 4, 5, 6, 7, 8],
        };

        let msg = build_message(&fee_payer, &ix, &blockhash);
        assert!(msg.is_ok(), "build_message should succeed: {:?}", msg.err());
        let msg = msg.unwrap();
        // Message must start with 3-byte header
        assert!(msg.len() > 3 + 32 + 32); // header + at least one key + blockhash
        // First 3 bytes are the header
        let num_signers = msg[0];
        assert!(num_signers >= 1, "must have at least 1 signer");
    }

    #[test]
    fn test_config_pda_derivation() {
        // Verify PDA derivation doesn't panic and produces a 32-byte pubkey
        let mint = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let program_id = Pubkey::from_str(PROGRAM_ID).unwrap();
        let (pda, bump) = Pubkey::find_program_address(
            &[b"stablecoin-config", mint.as_ref()],
            &program_id,
        );
        assert_ne!(pda.to_bytes(), [0u8; 32]);
        assert!(bump <= 255);
    }
}
