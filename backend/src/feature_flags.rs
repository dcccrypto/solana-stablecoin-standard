//! SSS-AUDIT2-C: Feature flag constants and incompatible combo detection.
//!
//! Flag values mirror programs/sss-token/src/state.rs FLAG_* constants.
//! The backend reads feature_flags from `AppState::feature_flags` (populated
//! by the background flag_refresh worker) and uses these to guard endpoints.

/// FLAG_CIRCUIT_BREAKER (bit 0) — halts mint/burn when set.
pub const FLAG_CIRCUIT_BREAKER: u64 = 1 << 0;
/// FLAG_ZK_COMPLIANCE (bit 4) — enables ZK compliance checks.
pub const FLAG_ZK_COMPLIANCE: u64 = 1 << 4;
/// FLAG_CONFIDENTIAL_TRANSFERS (bit 5) — enables Token-2022 confidential transfers.
pub const FLAG_CONFIDENTIAL_TRANSFERS: u64 = 1 << 5;
/// FLAG_TRAVEL_RULE (bit 6) — enables travel rule enforcement.
pub const FLAG_TRAVEL_RULE: u64 = 1 << 6;
/// FLAG_SANCTIONS_ORACLE (bit 7) — enables sanctions oracle queries.
pub const FLAG_SANCTIONS_ORACLE: u64 = 1 << 7;
/// FLAG_ZK_CREDENTIALS (bit 8) — enables ZK credential selective disclosure.
pub const FLAG_ZK_CREDENTIALS: u64 = 1 << 8;
/// FLAG_BRIDGE_ENABLED (bit 17) — enables cross-chain bridge hooks.
pub const FLAG_BRIDGE_ENABLED: u64 = 1 << 17;
/// FLAG_MARKET_MAKER_HOOKS (bit 18) — enables MM hooks.
#[allow(dead_code)]
pub const FLAG_MARKET_MAKER_HOOKS: u64 = 1 << 18;
/// FLAG_INSURANCE_VAULT_REQUIRED (bit 21) — requires insurance vault deposit.
#[allow(dead_code)]
pub const FLAG_INSURANCE_VAULT_REQUIRED: u64 = 1 << 21;

/// Check for known incompatible flag combinations.
///
/// Returns `Some(description)` if the given bitmask contains a problematic
/// combination of flags that should not be active simultaneously.
///
/// Known incompatible combos:
/// 1. FLAG_CIRCUIT_BREAKER + FLAG_BRIDGE_ENABLED — bridge should be disabled
///    when the circuit breaker is active (cross-chain txs bypass halt).
/// 2. FLAG_SANCTIONS_ORACLE set without FLAG_ZK_COMPLIANCE or
///    FLAG_ZK_CREDENTIALS — sanctions checks require an identity verification
///    path; neither is available.
pub fn check_incompatible_combos(flags: u64) -> Option<&'static str> {
    // CB active + bridge enabled = dangerous (cross-chain bridge bypasses CB halt)
    if flags & FLAG_CIRCUIT_BREAKER != 0 && flags & FLAG_BRIDGE_ENABLED != 0 {
        return Some(
            "FLAG_CIRCUIT_BREAKER + FLAG_BRIDGE_ENABLED both set: \
             bridge should be disabled when circuit breaker is active",
        );
    }

    // Sanctions oracle requires at least one identity verification path
    if flags & FLAG_SANCTIONS_ORACLE != 0
        && flags & FLAG_ZK_COMPLIANCE == 0
        && flags & FLAG_ZK_CREDENTIALS == 0
    {
        return Some(
            "FLAG_SANCTIONS_ORACLE set but neither FLAG_ZK_COMPLIANCE nor \
             FLAG_ZK_CREDENTIALS is set: sanctions checks lack identity verification path",
        );
    }

    None
}

// ─── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_incompatible_combos_clean() {
        assert!(check_incompatible_combos(0).is_none());
        assert!(check_incompatible_combos(FLAG_TRAVEL_RULE).is_none());
        assert!(
            check_incompatible_combos(FLAG_ZK_CREDENTIALS | FLAG_SANCTIONS_ORACLE).is_none()
        );
    }

    #[test]
    fn test_cb_plus_bridge_incompatible() {
        let flags = FLAG_CIRCUIT_BREAKER | FLAG_BRIDGE_ENABLED;
        assert!(check_incompatible_combos(flags).is_some());
    }

    #[test]
    fn test_cb_without_bridge_ok() {
        let flags = FLAG_CIRCUIT_BREAKER;
        assert!(check_incompatible_combos(flags).is_none());
    }

    #[test]
    fn test_bridge_without_cb_ok() {
        let flags = FLAG_BRIDGE_ENABLED;
        assert!(check_incompatible_combos(flags).is_none());
    }

    #[test]
    fn test_sanctions_without_identity_incompatible() {
        let flags = FLAG_SANCTIONS_ORACLE;
        assert!(check_incompatible_combos(flags).is_some());
    }

    #[test]
    fn test_sanctions_with_zk_compliance_ok() {
        let flags = FLAG_SANCTIONS_ORACLE | FLAG_ZK_COMPLIANCE;
        assert!(check_incompatible_combos(flags).is_none());
    }

    #[test]
    fn test_sanctions_with_zk_credentials_ok() {
        let flags = FLAG_SANCTIONS_ORACLE | FLAG_ZK_CREDENTIALS;
        assert!(check_incompatible_combos(flags).is_none());
    }

    #[test]
    fn test_all_compliance_flags_ok() {
        let flags = FLAG_TRAVEL_RULE
            | FLAG_SANCTIONS_ORACLE
            | FLAG_ZK_COMPLIANCE
            | FLAG_ZK_CREDENTIALS
            | FLAG_CONFIDENTIAL_TRANSFERS;
        assert!(check_incompatible_combos(flags).is_none());
    }
}
