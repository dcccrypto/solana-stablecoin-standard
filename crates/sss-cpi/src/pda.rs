//! PDA derivation helpers for all SSS on-chain accounts.
//!
//! Every PDA seed matches the `impl XxxStruct { pub const SEED }` definition
//! in `programs/sss-token/src/state.rs`.  Use these helpers to avoid
//! hard-coding seed strings in your program.

use anchor_lang::prelude::Pubkey;

use crate::sss_program_id;

// ── Seed constants (mirrors state.rs) ────────────────────────────────────────

const SEED_CONFIG: &[u8] = b"stablecoin-config";
const SEED_MINTER_INFO: &[u8] = b"minter-info";
const SEED_CDP_VAULT: &[u8] = b"cdp-collateral-vault";
const SEED_CDP_POSITION: &[u8] = b"cdp-position";
const SEED_INTERFACE_VERSION: &[u8] = b"interface-version";
const SEED_YIELD_COLLATERAL: &[u8] = b"yield-collateral";
const SEED_DAO_PROPOSAL: &[u8] = b"dao-proposal";
const SEED_DAO_COMMITTEE: &[u8] = b"dao-committee";
const SEED_ZK_COMPLIANCE_CONFIG: &[u8] = b"zk-compliance-config";
const SEED_ZK_VERIFICATION: &[u8] = b"zk-verification";
const SEED_COLLATERAL_CONFIG: &[u8] = b"collateral-config";
const SEED_CT_CONFIG: &[u8] = b"ct-config";
const SEED_PROOF_OF_RESERVES: &[u8] = b"proof-of-reserves";
const SEED_RESERVE_COMPOSITION: &[u8] = b"reserve-composition";
const SEED_REDEMPTION_GUARANTEE: &[u8] = b"redemption-guarantee";
const SEED_REDEMPTION_REQUEST: &[u8] = b"redemption-request";
const SEED_TRAVEL_RULE_RECORD: &[u8] = b"travel-rule-record";
const SEED_SANCTIONS_RECORD: &[u8] = b"sanctions-record";
const SEED_CREDENTIAL_REGISTRY: &[u8] = b"credential-registry";
const SEED_CREDENTIAL_RECORD: &[u8] = b"credential-record";
const SEED_PID_CONFIG: &[u8] = b"pid-config";
const SEED_AUTHORITY_ROTATION: &[u8] = b"authority-rotation-request";
const SEED_GUARDIAN_CONFIG: &[u8] = b"guardian-config";
const SEED_PAUSE_PROPOSAL: &[u8] = b"pause-proposal";
const SEED_CUSTOM_PRICE_FEED: &[u8] = b"custom-price-feed";
const SEED_LIQUIDATION_BONUS_CONFIG: &[u8] = b"liquidation-bonus-config";
const SEED_PSM_CURVE_CONFIG: &[u8] = b"psm-curve-config";
const SEED_WALLET_RATE_LIMIT: &[u8] = b"wallet-rate-limit";
const SEED_SQUADS_MULTISIG_CONFIG: &[u8] = b"squads-multisig-config";

// ── Core / SSS-1 PDAs ────────────────────────────────────────────────────────

/// Derive the `StablecoinConfig` PDA for a given mint.
///
/// Seeds: `["stablecoin-config", mint]`
pub fn find_config(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_CONFIG, mint.as_ref()], &sss_program_id())
}

/// Derive the `MinterInfo` PDA for a minter on a given config.
///
/// Seeds: `["minter-info", config, minter]`
pub fn find_minter_info(config: &Pubkey, minter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_MINTER_INFO, config.as_ref(), minter.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the `InterfaceVersion` PDA for a mint.
///
/// Seeds: `["interface-version", mint]`
pub fn find_interface_version(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_INTERFACE_VERSION, mint.as_ref()], &sss_program_id())
}

// ── CDP PDAs ──────────────────────────────────────────────────────────────────

/// Derive the CDP collateral vault PDA.
///
/// Seeds: `["cdp-collateral-vault", config, collateral_mint]`
pub fn find_cdp_vault(config: &Pubkey, collateral_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_CDP_VAULT, config.as_ref(), collateral_mint.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the CDP position PDA for a specific owner.
///
/// Seeds: `["cdp-position", config, owner]`
pub fn find_cdp_position(config: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_CDP_POSITION, config.as_ref(), owner.as_ref()],
        &sss_program_id(),
    )
}

// ── Governance PDAs ───────────────────────────────────────────────────────────

/// Derive the DAO committee PDA.
///
/// Seeds: `["dao-committee", config]`
pub fn find_dao_committee(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_DAO_COMMITTEE, config.as_ref()], &sss_program_id())
}

/// Derive a DAO proposal PDA by proposal ID.
///
/// Seeds: `["dao-proposal", config, &proposal_id.to_le_bytes()]`
pub fn find_dao_proposal(config: &Pubkey, proposal_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_DAO_PROPOSAL,
            config.as_ref(),
            &proposal_id.to_le_bytes(),
        ],
        &sss_program_id(),
    )
}

/// Derive the authority rotation request PDA.
///
/// Seeds: `["authority-rotation-request", mint]`
pub fn find_authority_rotation_request(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_AUTHORITY_ROTATION, mint.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the guardian config PDA.
///
/// Seeds: `["guardian-config", config]`
pub fn find_guardian_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_GUARDIAN_CONFIG, config.as_ref()], &sss_program_id())
}

/// Derive a pause proposal PDA.
///
/// Seeds: `["pause-proposal", config]`
pub fn find_pause_proposal(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_PAUSE_PROPOSAL, config.as_ref()], &sss_program_id())
}

// ── Compliance / KYC PDAs ─────────────────────────────────────────────────────

/// Derive the ZK compliance config PDA.
///
/// Seeds: `["zk-compliance-config", config]`
pub fn find_zk_compliance_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_ZK_COMPLIANCE_CONFIG, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive a ZK verification record PDA for a specific user.
///
/// Seeds: `["zk-verification", config, user]`
pub fn find_zk_verification_record(config: &Pubkey, user: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_ZK_VERIFICATION, config.as_ref(), user.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the credential registry PDA.
///
/// Seeds: `["credential-registry", config]`
pub fn find_credential_registry(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_CREDENTIAL_REGISTRY, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive a credential record PDA for a holder.
///
/// Seeds: `["credential-record", registry, holder]`
pub fn find_credential_record(registry: &Pubkey, holder: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_CREDENTIAL_RECORD, registry.as_ref(), holder.as_ref()],
        &sss_program_id(),
    )
}

/// Derive a travel rule record PDA for a transfer.
///
/// Seeds: `["travel-rule-record", config, &transfer_id.to_le_bytes()]`
pub fn find_travel_rule_record(config: &Pubkey, transfer_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_TRAVEL_RULE_RECORD,
            config.as_ref(),
            &transfer_id.to_le_bytes(),
        ],
        &sss_program_id(),
    )
}

/// Derive a sanctions record PDA for a wallet.
///
/// Seeds: `["sanctions-record", config, wallet]`
pub fn find_sanctions_record(config: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_SANCTIONS_RECORD, config.as_ref(), wallet.as_ref()],
        &sss_program_id(),
    )
}

// ── Reserve / Collateral PDAs ─────────────────────────────────────────────────

/// Derive the collateral config PDA.
///
/// Seeds: `["collateral-config", config, collateral_mint]`
pub fn find_collateral_config(config: &Pubkey, collateral_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_COLLATERAL_CONFIG,
            config.as_ref(),
            collateral_mint.as_ref(),
        ],
        &sss_program_id(),
    )
}

/// Derive the proof-of-reserves PDA.
///
/// Seeds: `["proof-of-reserves", sss_mint]`
pub fn find_proof_of_reserves(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_PROOF_OF_RESERVES, mint.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the reserve composition PDA.
///
/// Seeds: `["reserve-composition", config]`
pub fn find_reserve_composition(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_RESERVE_COMPOSITION, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the redemption guarantee PDA.
///
/// Seeds: `["redemption-guarantee", config]`
pub fn find_redemption_guarantee(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_REDEMPTION_GUARANTEE, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive a redemption request PDA for a specific user.
///
/// Seeds: `["redemption-request", config, requester]`
pub fn find_redemption_request(config: &Pubkey, requester: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_REDEMPTION_REQUEST,
            config.as_ref(),
            requester.as_ref(),
        ],
        &sss_program_id(),
    )
}

// ── Fee / Oracle PDAs ─────────────────────────────────────────────────────────

/// Derive the PID fee config PDA.
///
/// Seeds: `["pid-config", config]`
pub fn find_pid_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_PID_CONFIG, config.as_ref()], &sss_program_id())
}

/// Derive a custom price feed PDA.
///
/// Seeds: `["custom-price-feed", config]`
pub fn find_custom_price_feed(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_CUSTOM_PRICE_FEED, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the confidential transfer config PDA.
///
/// Seeds: `["ct-config", config]`
pub fn find_ct_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_CT_CONFIG, config.as_ref()], &sss_program_id())
}

// ── SSS-131 / SSS-132 / SSS-133 / SSS-134 PDAs ───────────────────────────────

/// Derive the liquidation bonus config PDA.
///
/// Seeds: `["liquidation-bonus-config", config]`
pub fn find_liquidation_bonus_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_LIQUIDATION_BONUS_CONFIG, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the PSM curve config PDA.
///
/// Seeds: `["psm-curve-config", config]`
pub fn find_psm_curve_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_PSM_CURVE_CONFIG, config.as_ref()],
        &sss_program_id(),
    )
}

/// Derive a wallet rate-limit PDA for a specific wallet.
///
/// Seeds: `["wallet-rate-limit", config, wallet]`
pub fn find_wallet_rate_limit(config: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_WALLET_RATE_LIMIT, config.as_ref(), wallet.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the Squads multisig config PDA.
///
/// Seeds: `["squads-multisig-config", sss_mint]`
pub fn find_squads_multisig_config(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_SQUADS_MULTISIG_CONFIG, mint.as_ref()],
        &sss_program_id(),
    )
}

/// Derive the yield collateral config PDA.
///
/// Seeds: `["yield-collateral", config]`
pub fn find_yield_collateral_config(config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_YIELD_COLLATERAL, config.as_ref()],
        &sss_program_id(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn dummy_mint() -> Pubkey {
        Pubkey::new_from_array([1u8; 32])
    }

    fn dummy_config() -> Pubkey {
        Pubkey::new_from_array([2u8; 32])
    }

    fn dummy_minter() -> Pubkey {
        Pubkey::new_from_array([3u8; 32])
    }

    fn dummy_wallet() -> Pubkey {
        Pubkey::new_from_array([4u8; 32])
    }

    #[test]
    fn find_config_is_deterministic() {
        let mint = dummy_mint();
        let (pda1, bump1) = find_config(&mint);
        let (pda2, bump2) = find_config(&mint);
        assert_eq!(pda1, pda2);
        assert_eq!(bump1, bump2);
    }

    #[test]
    fn find_minter_info_is_deterministic() {
        let config = dummy_config();
        let minter = dummy_minter();
        let (pda1, _) = find_minter_info(&config, &minter);
        let (pda2, _) = find_minter_info(&config, &minter);
        assert_eq!(pda1, pda2);
    }

    #[test]
    fn config_and_minter_info_pdas_differ() {
        let mint = dummy_mint();
        let (config_pda, _) = find_config(&mint);
        let (minter_info_pda, _) = find_minter_info(&config_pda, &dummy_minter());
        assert_ne!(config_pda, minter_info_pda);
    }

    #[test]
    fn find_interface_version_is_deterministic() {
        let mint = dummy_mint();
        let (pda1, _) = find_interface_version(&mint);
        let (pda2, _) = find_interface_version(&mint);
        assert_eq!(pda1, pda2);
    }

    #[test]
    fn different_mints_produce_different_config_pdas() {
        let mint1 = Pubkey::new_from_array([1u8; 32]);
        let mint2 = Pubkey::new_from_array([2u8; 32]);
        let (pda1, _) = find_config(&mint1);
        let (pda2, _) = find_config(&mint2);
        assert_ne!(pda1, pda2);
    }

    #[test]
    fn find_wallet_rate_limit_differs_by_wallet() {
        let config = dummy_config();
        let w1 = Pubkey::new_from_array([5u8; 32]);
        let w2 = Pubkey::new_from_array([6u8; 32]);
        let (pda1, _) = find_wallet_rate_limit(&config, &w1);
        let (pda2, _) = find_wallet_rate_limit(&config, &w2);
        assert_ne!(pda1, pda2);
    }

    #[test]
    fn find_dao_proposal_differs_by_id() {
        let config = dummy_config();
        let (p0, _) = find_dao_proposal(&config, 0);
        let (p1, _) = find_dao_proposal(&config, 1);
        assert_ne!(p0, p1);
    }

    #[test]
    fn pdas_are_off_curve() {
        // All program-derived addresses should be off the Ed25519 curve.
        let mint = dummy_mint();
        let (config, _) = find_config(&mint);
        // Pubkey::find_program_address guarantees the result is off-curve.
        // We can verify by attempting Pubkey::create_program_address with the
        // returned bump — it should succeed without panicking.
        let program_id = sss_program_id();
        let bump = find_config(&mint).1;
        let recreated = Pubkey::create_program_address(
            &[SEED_CONFIG, mint.as_ref(), &[bump]],
            &program_id,
        )
        .expect("valid PDA");
        assert_eq!(config, recreated);
    }

    /// Verify find_squads_multisig_config uses sss_mint (not config) as second seed.
    /// Seeds must be: ["squads-multisig-config", sss_mint] per state.rs SquadsMultisigConfig.
    #[test]
    fn find_squads_multisig_config_uses_mint_seed() {
        let mint = dummy_mint();
        let program_id = sss_program_id();
        let (pda, bump) = find_squads_multisig_config(&mint);
        // Re-derive manually with the expected seeds to confirm they match.
        let expected = Pubkey::create_program_address(
            &[SEED_SQUADS_MULTISIG_CONFIG, mint.as_ref(), &[bump]],
            &program_id,
        )
        .expect("valid PDA");
        assert_eq!(pda, expected, "squads_multisig_config seed must be sss_mint");

        // Also confirm it differs from a config-seeded derivation (would be wrong).
        let config = dummy_config();
        let (pda_wrong, _) = Pubkey::find_program_address(
            &[SEED_SQUADS_MULTISIG_CONFIG, config.as_ref()],
            &program_id,
        );
        assert_ne!(pda, pda_wrong, "config-seeded PDA must not match mint-seeded PDA");
    }

    /// Verify find_proof_of_reserves uses sss_mint (not config) as second seed.
    /// Seeds must be: ["proof-of-reserves", sss_mint] per state.rs ProofOfReserves.
    #[test]
    fn find_proof_of_reserves_uses_mint_seed() {
        let mint = dummy_mint();
        let program_id = sss_program_id();
        let (pda, bump) = find_proof_of_reserves(&mint);
        // Re-derive manually with the expected seeds to confirm they match.
        let expected = Pubkey::create_program_address(
            &[SEED_PROOF_OF_RESERVES, mint.as_ref(), &[bump]],
            &program_id,
        )
        .expect("valid PDA");
        assert_eq!(pda, expected, "proof_of_reserves seed must be sss_mint");

        // Also confirm it differs from a config-seeded derivation (would be wrong).
        let config = dummy_config();
        let (pda_wrong, _) = Pubkey::find_program_address(
            &[SEED_PROOF_OF_RESERVES, config.as_ref()],
            &program_id,
        );
        assert_ne!(pda, pda_wrong, "config-seeded PDA must not match mint-seeded PDA");
    }
}
