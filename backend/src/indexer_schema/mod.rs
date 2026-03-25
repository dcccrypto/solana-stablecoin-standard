//! SSS Event Schema v1 — IDL-to-webhook transformer.
#![allow(dead_code)]
//!
//! Parses on-chain Anchor program log lines and emits structured JSON events
//! for Helius, Shyft, Triton and any SSS-compatible indexer.
//!
//! # Event discriminators
//! Each event carries an 8-byte Anchor discriminator (sha256("event:<Name>")[..8]).
//! Known discriminators are listed in [`EVENT_DISCRIMINATORS`].
//!
//! # Usage
//! ```rust
//! use crate::indexer_schema::{parse_log_line, SssEvent};
//! if let Some(event) = parse_log_line("Program log: MintExecuted { ... }") {
//!     println!("{}", serde_json::to_string(&event).unwrap());
//! }
//! ```

use serde::{Deserialize, Serialize};

// ─── Canonical event type strings ────────────────────────────────────────────

/// All SSS event type identifiers (v1).
pub const EVENT_TYPES: &[&str] = &[
    "MintExecuted",
    "BurnExecuted",
    "CDPOpened",
    "CDPRepaid",
    "CDPLiquidated",
    "CircuitBreakerTriggered",
    "ReserveAttestation",
    "OracleParamsUpdated",
    "StabilityFeeAccrued",
    "CollateralRegistered",
    "CollateralConfigUpdated",
    "TransferHookExecuted",
    "SpendPolicyUpdated",
];

/// 8-byte Anchor discriminator prefix → canonical event name.
/// Generated as sha256("event:<Name>")[..8].
pub const EVENT_DISCRIMINATORS: &[([u8; 8], &str)] = &[
    ([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d], "MintExecuted"),
    ([0x1c, 0x9b, 0x02, 0xed, 0x3f, 0x7b, 0xd4, 0x3b], "BurnExecuted"),
    ([0xa8, 0x3c, 0x50, 0x1e, 0xf5, 0x2c, 0xd8, 0x6a], "CDPOpened"),
    ([0x7d, 0x4f, 0xb1, 0x22, 0xcc, 0x09, 0xa0, 0x5e], "CDPRepaid"),
    ([0x3b, 0x7e, 0x1d, 0x40, 0x9f, 0x81, 0x6c, 0xb2], "CDPLiquidated"),
    ([0xf1, 0x2d, 0x8e, 0x03, 0x47, 0xac, 0xb9, 0x5c], "CircuitBreakerTriggered"),
    ([0x2a, 0xc1, 0x77, 0x4e, 0x0b, 0xd5, 0xe3, 0x91], "ReserveAttestation"),
    ([0x6e, 0x91, 0x3f, 0xb8, 0x55, 0x2d, 0x04, 0xc7], "OracleParamsUpdated"),
    ([0x84, 0x0f, 0x6b, 0xd9, 0x1c, 0xe2, 0x58, 0xaf], "StabilityFeeAccrued"),
    ([0xd3, 0x5a, 0x87, 0x16, 0x4a, 0x79, 0xb0, 0xf3], "CollateralRegistered"),
    ([0x9c, 0x63, 0x2e, 0xf7, 0x38, 0x1b, 0xd1, 0x85], "CollateralConfigUpdated"),
    ([0xb7, 0x2f, 0x54, 0x0c, 0x61, 0xe5, 0x9d, 0x27], "TransferHookExecuted"),
    ([0x4d, 0x88, 0xc3, 0x71, 0x06, 0xa4, 0xf2, 0xbe], "SpendPolicyUpdated"),
];

// ─── Structured event envelope ────────────────────────────────────────────────

/// A parsed SSS on-chain event, ready for webhook delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SssEvent {
    /// Schema version — always `"1"` for this module.
    pub schema_version: String,
    /// Canonical event type (see `EVENT_TYPES`).
    pub event_type: String,
    /// Raw field data extracted from the log line (JSON object).
    pub data: serde_json::Value,
    /// Transaction signature (base58).  Set by the indexer task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Slot number.  Set by the indexer task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<u64>,
    /// ISO-8601 timestamp the event was observed by the indexer.
    pub observed_at: String,
}

impl SssEvent {
    /// Construct a new event with the current UTC timestamp.
    pub fn new(event_type: impl Into<String>, data: serde_json::Value) -> Self {
        SssEvent {
            schema_version: "1".to_string(),
            event_type: event_type.into(),
            data,
            signature: None,
            slot: None,
            observed_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// Attach transaction context.
    pub fn with_tx(mut self, signature: String, slot: u64) -> Self {
        self.signature = Some(signature);
        self.slot = Some(slot);
        self
    }
}

// ─── Log line parser ──────────────────────────────────────────────────────────

/// Parse a single Anchor `Program log:` line into an `SssEvent`.
///
/// Expects the format: `Program log: <EventName> { <fields> }`
/// Returns `None` if the line doesn't match a known SSS event.
pub fn parse_log_line(line: &str) -> Option<SssEvent> {
    let line = line.trim();

    // Must start with "Program log: "
    let body = line.strip_prefix("Program log: ")?;

    // Find event name (up to first space or '{')
    let sep = body.find([' ', '{']).unwrap_or(body.len());
    let event_name = &body[..sep];

    // Check it's a known event
    if !EVENT_TYPES.contains(&event_name) {
        return None;
    }

    // Try to parse the trailing JSON payload
    let json_part = body[sep..].trim();
    let data: serde_json::Value = if json_part.starts_with('{') {
        // Anchor debug-format: replace single quotes, fix trailing commas, etc.
        let cleaned = json_part
            .replace('\'', "\"")
            // Anchor may emit `key: value` without quotes on keys; best-effort only.
            ;
        serde_json::from_str(&cleaned).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    Some(SssEvent::new(event_name, data))
}

/// Parse a `Program data:` base64-encoded line and attempt to identify the event
/// by its 8-byte Anchor discriminator.
///
/// Returns `(event_name, raw_bytes)` on success.
pub fn parse_program_data(line: &str) -> Option<(&'static str, Vec<u8>)> {
    let b64 = line.trim().strip_prefix("Program data: ")?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).ok()?;
    if bytes.len() < 8 {
        return None;
    }
    let disc: [u8; 8] = bytes[..8].try_into().ok()?;
    for (d, name) in EVENT_DISCRIMINATORS {
        if *d == disc {
            return Some((*name, bytes));
        }
    }
    None
}

// ─── HMAC-SHA256 signing ──────────────────────────────────────────────────────

/// Compute HMAC-SHA256 over `payload` using `secret` and return a hex string.
/// Used to sign webhook deliveries so subscribers can verify authenticity.
pub fn hmac_sha256_hex(secret: &str, payload: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mint_executed() {
        let line = r#"Program log: MintExecuted {"amount":1000000,"recipient":"7xKX..."}"#;
        let event = parse_log_line(line).expect("should parse MintExecuted");
        assert_eq!(event.event_type, "MintExecuted");
        assert_eq!(event.schema_version, "1");
        assert_eq!(event.data["amount"], 1_000_000_u64);
    }

    #[test]
    fn test_parse_burn_executed() {
        let line = r#"Program log: BurnExecuted {"amount":500000,"sender":"AbCd..."}"#;
        let event = parse_log_line(line).expect("should parse BurnExecuted");
        assert_eq!(event.event_type, "BurnExecuted");
    }

    #[test]
    fn test_parse_cdp_opened() {
        let line = r#"Program log: CDPOpened {"collateral":"SOL","amount":2000000000}"#;
        let event = parse_log_line(line).expect("should parse CDPOpened");
        assert_eq!(event.event_type, "CDPOpened");
        assert_eq!(event.data["collateral"], "SOL");
    }

    #[test]
    fn test_parse_cdp_liquidated() {
        let line = r#"Program log: CDPLiquidated {"position":"3xZZ...","liquidator":"9aBC..."}"#;
        let event = parse_log_line(line).expect("should parse CDPLiquidated");
        assert_eq!(event.event_type, "CDPLiquidated");
    }

    #[test]
    fn test_parse_circuit_breaker_triggered() {
        let line = r#"Program log: CircuitBreakerTriggered {"feature":3,"enabled":false}"#;
        let event = parse_log_line(line).expect("should parse CircuitBreakerTriggered");
        assert_eq!(event.event_type, "CircuitBreakerTriggered");
    }

    #[test]
    fn test_parse_reserve_attestation() {
        let line = r#"Program log: ReserveAttestation {"total_collateral":9999999,"timestamp":1711111111}"#;
        let event = parse_log_line(line).expect("should parse ReserveAttestation");
        assert_eq!(event.event_type, "ReserveAttestation");
    }

    #[test]
    fn test_unknown_event_returns_none() {
        let line = "Program log: RandomThing { \"x\": 1 }";
        assert!(parse_log_line(line).is_none());
    }

    #[test]
    fn test_non_log_line_returns_none() {
        let line = "Program data: AAAAAAAAAA==";
        // parse_log_line should return None (wrong prefix)
        assert!(parse_log_line(line).is_none());
    }

    #[test]
    fn test_event_with_tx_context() {
        let event = SssEvent::new("MintExecuted", serde_json::json!({"amount": 100}))
            .with_tx("5xSig...".to_string(), 123_456_789);
        assert_eq!(event.signature.as_deref(), Some("5xSig..."));
        assert_eq!(event.slot, Some(123_456_789));
    }

    #[test]
    fn test_hmac_signing_deterministic() {
        let sig1 = hmac_sha256_hex("secret", "hello");
        let sig2 = hmac_sha256_hex("secret", "hello");
        assert_eq!(sig1, sig2);
        assert_ne!(sig1, "");
        // Different secret → different sig
        let sig3 = hmac_sha256_hex("other-secret", "hello");
        assert_ne!(sig1, sig3);
    }

    #[test]
    fn test_parse_program_data_unknown_disc() {
        // Random base64 with wrong discriminator — should return None
        let line = "Program data: AAAAAAAAAA==";
        assert!(parse_program_data(line).is_none());
    }

    #[test]
    fn test_event_serializes_schema_version() {
        let event = SssEvent::new("BurnExecuted", serde_json::json!({}));
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"schema_version\":\"1\""));
    }

    #[test]
    fn test_all_event_types_covered() {
        // Ensure every type in EVENT_TYPES has a matching discriminator entry
        for etype in EVENT_TYPES {
            let found = EVENT_DISCRIMINATORS.iter().any(|(_, name)| name == etype);
            assert!(found, "Missing discriminator for event type: {}", etype);
        }
    }
}
