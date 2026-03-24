use anchor_lang::prelude::*;
use crate::state::StablecoinConfig;
use crate::error::SssError;

// ---------------------------------------------------------------------------
// SSS-122: Program upgrade path — versioned state migration
// ---------------------------------------------------------------------------

/// Current program version. Increment each time a breaking state layout change
/// is deployed. Handlers reject configs with version < MIN_SUPPORTED_VERSION.
pub const CURRENT_VERSION: u8 = 1;

/// Minimum config version accepted by this program build.
/// v0 = pre-SSS-122 (no version field); handlers set it to 1 on first migration.
pub const MIN_SUPPORTED_VERSION: u8 = 1;

/// Migrate a StablecoinConfig from v0 (no version field / default-zero) to
/// the current version. This is the only instruction that accepts v0 configs.
///
/// Idempotent: calling it on an already-migrated config is a no-op (returns Ok).
/// Token-2022 mint accounts are NOT touched — only the config PDA is updated.
/// Existing CDPs, vaults, minter records, and ATAs continue working unchanged.
pub fn migrate_config_handler(ctx: Context<MigrateConfig>) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;

    // If already current, no-op.
    if config.version >= CURRENT_VERSION {
        return Ok(());
    }

    // v0 → v1 migration: set version and any newly-added default fields.
    // All existing fields are layout-compatible; only version is new.
    config.version = CURRENT_VERSION;

    emit!(ConfigMigrated {
        mint: config.mint,
        from_version: 0,
        to_version: CURRENT_VERSION,
        slot: Clock::get()?.slot,
    });

    msg!(
        "SSS-122: config migrated v0→{} for mint {}",
        CURRENT_VERSION,
        config.mint
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// The authority of the stablecoin — only they may trigger migration.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The config PDA to migrate.
    /// We accept version==0 here specifically (MIN_SUPPORTED_VERSION check is
    /// deliberately skipped in this instruction).
    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ConfigMigrated {
    pub mint: Pubkey,
    pub from_version: u8,
    pub to_version: u8,
    pub slot: u64,
}
