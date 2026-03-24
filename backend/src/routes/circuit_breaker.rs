//! SSS-061: POST /api/admin/circuit-breaker
//!
//! Enables or disables the on-chain FLAG_CIRCUIT_BREAKER feature flag for a
//! given stablecoin mint.
//!
//! # E-1 Security Fix
//! The previous implementation accepted a raw 64-byte ed25519 keypair in the
//! request body, signed the transaction server-side, and broadcast it.  This is
//! a key-exfiltration risk: anyone who can MITM the request or read logs gets
//! the private key.
//!
//! The new design follows the standard "prepare-then-sign" pattern used by all
//! modern Solana wallets and dApps:
//!   1. Caller sends only `{ mint, enabled, authority_pubkey }`.
//!   2. Backend fetches a recent blockhash from the RPC node.
//!   3. Backend builds the unsigned transaction message (base64) and returns it
//!      along with the blockhash and the authority pubkey.
//!   4. The caller signs the message client-side (e.g. with a hardware wallet,
//!      Phantom, or `solana-keygen sign`) and broadcasts via their own RPC
//!      connection or a separate `/api/admin/broadcast` endpoint.
//!
//! The private key NEVER leaves the caller's machine.

use std::str::FromStr;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

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
    /// Base58-encoded authority pubkey.  The PRIVATE KEY stays with the caller.
    pub authority_pubkey: String,
}

#[derive(Debug, Serialize)]
pub struct CircuitBreakerResponse {
    pub mint: String,
    pub enabled: bool,
    /// Base64-encoded serialized unsigned transaction message.
    /// Sign this with your authority key and broadcast it.
    pub unsigned_tx_message_b64: String,
    /// The recent blockhash used; baked into the message.
    pub recent_blockhash: String,
    /// The authority pubkey echoed back for confirmation.
    pub authority_pubkey: String,
    pub flag: &'static str,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn set_circuit_breaker(
    State(state): State<AppState>,
    Json(req): Json<CircuitBreakerRequest>,
) -> Result<Json<ApiResponse<CircuitBreakerResponse>>, AppError> {
    // 1. Parse mint pubkey
    let mint_pubkey = Pubkey::from_str(&req.mint)
        .map_err(|_| AppError::BadRequest(format!("Invalid mint pubkey: {}", req.mint)))?;

    // 2. Parse authority pubkey (public key only — no private key accepted)
    let authority_pubkey = Pubkey::from_str(&req.authority_pubkey)
        .map_err(|_| AppError::BadRequest(format!("Invalid authority_pubkey: {}", req.authority_pubkey)))?;

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
    data.extend_from_slice(&FLAG_CIRCUIT_BREAKER.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(authority_pubkey, true),  // authority (signer — offline)
        AccountMeta::new(config_pda, false),                 // config (mut)
        AccountMeta::new_readonly(mint_pubkey, false),       // mint
        AccountMeta::new_readonly(token_program_id, false),  // token_program
    ];

    let instruction = Instruction {
        program_id,
        accounts,
        data,
    };

    // 5. Fetch recent blockhash from RPC (no signing — only for tx preparation)
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());

    let client = reqwest::Client::new();
    let (message_bytes, blockhash_str) =
        build_unsigned_message(&client, &rpc_url, &authority_pubkey, instruction)
            .await
            .map_err(|e| AppError::Internal(format!("RPC error: {e}")))?;

    let unsigned_tx_b64 = base64_encode(&message_bytes);

    // 6. Audit log (intent recorded; tx not yet broadcast)
    let action = if req.enabled { "CIRCUIT_BREAKER_PREPARE_ENABLE" } else { "CIRCUIT_BREAKER_PREPARE_DISABLE" };
    let details = format!(
        "Unsigned circuit-breaker tx prepared ({}) for mint {} by authority {}",
        if req.enabled { "ENABLE" } else { "DISABLE" },
        req.mint,
        req.authority_pubkey,
    );
    state.db.add_audit(action, &req.mint, &details)?;

    Ok(Json(ApiResponse::ok(CircuitBreakerResponse {
        mint: req.mint,
        enabled: req.enabled,
        unsigned_tx_message_b64: unsigned_tx_b64,
        recent_blockhash: blockhash_str,
        authority_pubkey: req.authority_pubkey,
        flag: "FLAG_CIRCUIT_BREAKER",
    })))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Fetch a recent blockhash and build an unsigned Solana legacy transaction
/// message.  Returns (message_bytes, blockhash_base58).
async fn build_unsigned_message(
    client: &reqwest::Client,
    rpc_url: &str,
    fee_payer: &Pubkey,
    instruction: Instruction,
) -> Result<(Vec<u8>, String), String> {
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
        .ok_or("missing blockhash in RPC response")?
        .to_string();

    let blockhash_bytes = bs58::decode(&blockhash_str)
        .into_vec()
        .map_err(|_| "invalid blockhash base58")?;
    if blockhash_bytes.len() != 32 {
        return Err(format!("unexpected blockhash length: {}", blockhash_bytes.len()));
    }

    let message_bytes = build_message(fee_payer, &instruction, &blockhash_bytes)?;
    Ok((message_bytes, blockhash_str))
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

/// Build a Solana legacy transaction message (manual binary encoding).
fn build_message(
    fee_payer: &Pubkey,
    ix: &Instruction,
    recent_blockhash: &[u8],
) -> Result<Vec<u8>, String> {
    let mut keys: Vec<Pubkey> = vec![*fee_payer];
    let mut writable: Vec<bool> = vec![true];
    let mut signer: Vec<bool> = vec![true];

    for meta in &ix.accounts {
        if let Some(pos) = keys.iter().position(|k| k == &meta.pubkey) {
            if meta.is_writable { writable[pos] = true; }
            if meta.is_signer { signer[pos] = true; }
        } else {
            keys.push(meta.pubkey);
            writable.push(meta.is_writable);
            signer.push(meta.is_signer);
        }
    }
    if !keys.contains(&ix.program_id) {
        keys.push(ix.program_id);
        writable.push(false);
        signer.push(false);
    }

    let num_signers = signer.iter().filter(|&&s| s).count() as u8;
    let num_readonly_signed = signer.iter().zip(writable.iter())
        .filter(|(&s, &w)| s && !w).count() as u8;
    let num_readonly_unsigned = signer.iter().zip(writable.iter())
        .filter(|(&s, &w)| !s && !w).count() as u8;

    let mut indexed: Vec<(usize, Pubkey, bool, bool)> = keys.iter().enumerate()
        .map(|(i, k)| (i, *k, writable[i], signer[i]))
        .collect();
    indexed.sort_by(|a, b| {
        b.3.cmp(&a.3).then(b.2.cmp(&a.2))
    });

    let sorted_keys: Vec<Pubkey> = indexed.iter().map(|x| x.1).collect();

    let key_index = |pk: &Pubkey| -> Result<u8, String> {
        sorted_keys.iter().position(|k| k == pk)
            .map(|i| i as u8)
            .ok_or_else(|| format!("pubkey {pk} not in account list"))
    };

    let ix_accounts: Vec<u8> = ix.accounts.iter()
        .map(|m| key_index(&m.pubkey))
        .collect::<Result<Vec<_>, _>>()?;
    let program_index = key_index(&ix.program_id)?;

    let mut msg: Vec<u8> = Vec::new();
    msg.push(num_signers);
    msg.push(num_readonly_signed);
    msg.push(num_readonly_unsigned);

    encode_compact_u16(&mut msg, sorted_keys.len() as u16);
    for k in &sorted_keys {
        msg.extend_from_slice(k.as_ref());
    }

    msg.extend_from_slice(recent_blockhash);

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_instruction_data_set_flag() {
        let disc = anchor_discriminator("global:set_feature_flag");
        let mut data = disc.to_vec();
        data.extend_from_slice(&FLAG_CIRCUIT_BREAKER.to_le_bytes());
        assert_eq!(data.len(), 16);
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
        assert_eq!(buf, vec![0x80, 0x01]);
    }

    #[test]
    fn test_base64_encode_known() {
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn test_build_message_structure() {
        let fee_payer = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
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
        assert!(msg.len() > 3 + 32 + 32);
        let num_signers = msg[0];
        assert!(num_signers >= 1, "must have at least 1 signer");
    }

    #[test]
    fn test_config_pda_derivation() {
        let mint = Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap();
        let program_id = Pubkey::from_str(PROGRAM_ID).unwrap();
        let (pda, bump) = Pubkey::find_program_address(
            &[b"stablecoin-config", mint.as_ref()],
            &program_id,
        );
        assert_ne!(pda.to_bytes(), [0u8; 32]);
        let _ = bump;
    }

    #[test]
    fn test_request_rejects_keypair_field() {
        // Ensure CircuitBreakerRequest no longer has authority_keypair field.
        // This is a compile-time guarantee — the struct only has authority_pubkey.
        // If this compiles, E-1 is structurally enforced.
        let _req = CircuitBreakerRequest {
            mint: "So11111111111111111111111111111111111111112".to_string(),
            enabled: true,
            authority_pubkey: "So11111111111111111111111111111111111111112".to_string(),
        };
    }
}
