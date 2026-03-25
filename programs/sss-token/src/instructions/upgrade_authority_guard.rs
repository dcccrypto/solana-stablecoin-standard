use anchor_lang::prelude::*;
use crate::error::SssError;
use crate::state::{StablecoinConfig, FLAG_SQUADS_AUTHORITY};

// ---------------------------------------------------------------------------
// SSS-150: Upgrade authority guard — on-chain BPF upgrade authority enforcement
// ---------------------------------------------------------------------------
//
// Solana's BPF loader has no native timelock on program upgrades. Once the
// upgrade authority is transferred to a Squads multisig, upgrades still execute
// immediately when the multisig threshold is reached (no on-chain delay).
//
// This instruction records the *expected* upgrade authority in the stablecoin
// config PDA. Off-chain tooling (deployment scripts, monitoring) can read
// `expected_upgrade_authority` and alert if the actual BPF upgrade authority
// diverges — enabling rapid response to unauthorized authority changes.
//
// The companion `verify_upgrade_authority` instruction provides an on-chain
// assertion that clients can call as part of any admin flow to detect guard
// drift early.
//
// Trust model:
//   - `set_upgrade_authority_guard` is irreversible once set (to prevent
//     an attacker who compromises the authority key from clearing the guard).
//   - Requires FLAG_SQUADS_AUTHORITY to be set — a Squads multisig must be
//     configured before the upgrade authority guard can be recorded.
//   - The guard pubkey MUST equal the configured squads_multisig.
//
// Usage:
//   1. Deploy program, transfer BPF upgrade authority to Squads multisig.
//   2. Call `init_squads_authority` to set FLAG_SQUADS_AUTHORITY.
//   3. Call `set_upgrade_authority_guard(squads_multisig_pubkey)` once.
//   4. Monitoring scripts compare on-chain BPF upgrade authority against
//      `config.expected_upgrade_authority` on every block.

/// Record the expected BPF upgrade authority in the stablecoin config.
/// Irreversible: once set, `expected_upgrade_authority` cannot be changed.
/// Requires FLAG_SQUADS_AUTHORITY (Squads must be configured first).
/// The supplied `upgrade_authority` must equal `config.squads_multisig`.
pub fn set_upgrade_authority_guard_handler(
    ctx: Context<SetUpgradeAuthorityGuard>,
    upgrade_authority: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    // Squads must already be configured.
    require!(
        config.feature_flags & FLAG_SQUADS_AUTHORITY != 0,
        SssError::Unauthorized
    );

    // Guard must be the Squads multisig that was already recorded.
    require_keys_eq!(
        upgrade_authority,
        config.squads_multisig,
        SssError::UpgradeAuthorityGuardInvalidKey
    );

    // Reject default pubkey — must be a real key.
    require!(
        upgrade_authority != Pubkey::default(),
        SssError::UpgradeAuthorityGuardInvalidKey
    );

    // Irreversible: cannot set twice.
    require!(
        config.expected_upgrade_authority == Pubkey::default(),
        SssError::UpgradeAuthorityGuardAlreadySet
    );

    config.expected_upgrade_authority = upgrade_authority;

    emit!(UpgradeAuthorityGuardSet {
        mint: config.mint,
        expected_upgrade_authority: upgrade_authority,
        slot: Clock::get()?.slot,
    });

    msg!(
        "SSS-150: upgrade authority guard set to {} for mint {}",
        upgrade_authority,
        config.mint,
    );
    Ok(())
}

/// Verify that the provided upgrade authority matches the recorded guard.
/// Callable by anyone — designed for use in CI, deployment scripts, and
/// monitoring pipelines to detect drift between the BPF upgrade authority
/// and the expected value stored in config.
///
/// Returns `UpgradeAuthorityGuardNotSet` if no guard has been configured.
/// Returns `UpgradeAuthorityMismatch` if the supplied key does not match.
/// Returns `Ok(())` if they match — signals healthy state.
pub fn verify_upgrade_authority_handler(
    ctx: Context<VerifyUpgradeAuthority>,
    current_upgrade_authority: Pubkey,
) -> Result<()> {
    let config = &ctx.accounts.config;

    require!(
        config.expected_upgrade_authority != Pubkey::default(),
        SssError::UpgradeAuthorityGuardNotSet
    );

    require_keys_eq!(
        current_upgrade_authority,
        config.expected_upgrade_authority,
        SssError::UpgradeAuthorityMismatch
    );

    emit!(UpgradeAuthorityVerified {
        mint: config.mint,
        expected_upgrade_authority: config.expected_upgrade_authority,
        slot: Clock::get()?.slot,
    });

    msg!(
        "SSS-150: upgrade authority verified OK: {} for mint {}",
        current_upgrade_authority,
        config.mint,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetUpgradeAuthorityGuard<'info> {
    /// The current authority (must sign; guard is irreversible so we enforce
    /// both authority signature and Squads guard via FLAG_SQUADS_AUTHORITY check
    /// inside the handler).
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        has_one = authority @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

#[derive(Accounts)]
pub struct VerifyUpgradeAuthority<'info> {
    /// Read-only: anyone can call verify. No signer required.
    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct UpgradeAuthorityGuardSet {
    pub mint: Pubkey,
    pub expected_upgrade_authority: Pubkey,
    pub slot: u64,
}

#[event]
pub struct UpgradeAuthorityVerified {
    pub mint: Pubkey,
    pub expected_upgrade_authority: Pubkey,
    pub slot: u64,
}
