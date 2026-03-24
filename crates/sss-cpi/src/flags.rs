//! Feature flag constants mirroring `sss-token::state`.
//!
//! These are bit positions in `StablecoinConfig.feature_flags`.
//! Keep in sync with `programs/sss-token/src/state.rs`.

/// Circuit breaker (bit 0): when set, all mint/transfer/burn ops fail.
pub const FLAG_CIRCUIT_BREAKER: u64 = 1 << 0;

/// Spend policy (bit 1): per-tx transfer amount capped at `max_transfer_amount`.
pub const FLAG_SPEND_POLICY: u64 = 1 << 1;

/// DAO committee (bit 2): privileged admin operations require a passed proposal.
pub const FLAG_DAO_COMMITTEE: u64 = 1 << 2;

/// Yield-bearing collateral (bit 3): only whitelisted SPL tokens accepted as collateral.
pub const FLAG_YIELD_COLLATERAL: u64 = 1 << 3;

/// ZK compliance (bit 4): transfers require a valid zero-knowledge proof.
pub const FLAG_ZK_COMPLIANCE: u64 = 1 << 4;

/// Confidential transfers (bit 5): mint initialized with Token-2022 confidential transfer extension.
pub const FLAG_CONFIDENTIAL_TRANSFERS: u64 = 1 << 5;

/// Probabilistic money (bit 6): probabilistic-settlement payment channels enabled.
pub const FLAG_PROBABILISTIC_MONEY: u64 = 1 << 6;

/// Agent payment channel (bit 7): APC channel-based escrow payments enabled.
pub const FLAG_AGENT_PAYMENT_CHANNEL: u64 = 1 << 7;

/// Travel rule (bit 8): VASP travel-rule compliance records required for large transfers.
pub const FLAG_TRAVEL_RULE: u64 = 1 << 8;

/// Sanctions oracle (bit 9): on-chain sanctions screening via oracle PDA.
pub const FLAG_SANCTIONS_ORACLE: u64 = 1 << 9;

/// ZK credentials (bit 10): credential-based transfer authorization.
pub const FLAG_ZK_CREDENTIALS: u64 = 1 << 10;

/// PID fee control (bit 11): stability fee governed by a PID controller.
pub const FLAG_PID_FEE_CONTROL: u64 = 1 << 11;

/// Graduated liquidation bonus (bit 12): dynamic liquidation incentives by collateral health.
pub const FLAG_GRAD_LIQUIDATION_BONUS: u64 = 1 << 12;

/// PSM dynamic fees (bit 13): AMM-style depth-based PSM slippage curves.
pub const FLAG_PSM_DYNAMIC_FEES: u64 = 1 << 13;

/// Wallet rate limits (bit 14): rolling-window per-wallet spend controls in transfer hook.
pub const FLAG_WALLET_RATE_LIMITS: u64 = 1 << 14;

/// Squads authority (bit 15): authority transferred to a Squads V4 multisig PDA.
pub const FLAG_SQUADS_AUTHORITY: u64 = 1 << 15;

/// PoR halt on breach (bit 16): minting halted when proof-of-reserves attestation shows breach.
pub const FLAG_POR_HALT_ON_BREACH: u64 = 1 << 16;

/// Returns `true` if `flags` has the given flag bit set.
///
/// ```rust
/// use sss_cpi::flags::{has_flag, FLAG_CIRCUIT_BREAKER, FLAG_SPEND_POLICY};
/// let flags: u64 = FLAG_CIRCUIT_BREAKER | FLAG_SPEND_POLICY;
/// assert!(has_flag(flags, FLAG_CIRCUIT_BREAKER));
/// assert!(has_flag(flags, FLAG_SPEND_POLICY));
/// assert!(!has_flag(flags, 1 << 3));
/// ```
pub fn has_flag(flags: u64, flag: u64) -> bool {
    flags & flag != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_overlap_in_flag_bits() {
        let all = [
            FLAG_CIRCUIT_BREAKER,
            FLAG_SPEND_POLICY,
            FLAG_DAO_COMMITTEE,
            FLAG_YIELD_COLLATERAL,
            FLAG_ZK_COMPLIANCE,
            FLAG_CONFIDENTIAL_TRANSFERS,
            FLAG_PROBABILISTIC_MONEY,
            FLAG_AGENT_PAYMENT_CHANNEL,
            FLAG_TRAVEL_RULE,
            FLAG_SANCTIONS_ORACLE,
            FLAG_ZK_CREDENTIALS,
            FLAG_PID_FEE_CONTROL,
            FLAG_GRAD_LIQUIDATION_BONUS,
            FLAG_PSM_DYNAMIC_FEES,
            FLAG_WALLET_RATE_LIMITS,
            FLAG_SQUADS_AUTHORITY,
            FLAG_POR_HALT_ON_BREACH,
        ];
        let mut combined: u64 = 0;
        for &f in &all {
            assert_eq!(combined & f, 0, "flag {:#x} overlaps with prior flags", f);
            combined |= f;
        }
    }

    #[test]
    fn has_flag_true_for_set_bit() {
        assert!(has_flag(FLAG_CIRCUIT_BREAKER, FLAG_CIRCUIT_BREAKER));
    }

    #[test]
    fn has_flag_false_for_unset_bit() {
        assert!(!has_flag(0, FLAG_CIRCUIT_BREAKER));
    }

    #[test]
    fn has_flag_combined_flags() {
        let flags = FLAG_SQUADS_AUTHORITY | FLAG_POR_HALT_ON_BREACH;
        assert!(has_flag(flags, FLAG_SQUADS_AUTHORITY));
        assert!(has_flag(flags, FLAG_POR_HALT_ON_BREACH));
        assert!(!has_flag(flags, FLAG_CIRCUIT_BREAKER));
    }
}
