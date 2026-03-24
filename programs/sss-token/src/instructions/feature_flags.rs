use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{StablecoinConfig, FLAG_DAO_COMMITTEE};

// ---------------------------------------------------------------------------
// Shared account context — authority sets or clears a feature flag
// ---------------------------------------------------------------------------
#[derive(Accounts)]
pub struct UpdateFeatureFlag<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Set a feature flag bit (turn the feature ON).
pub fn set_feature_flag_handler(
    ctx: Context<UpdateFeatureFlag>,
    flag: u64,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;
    // When FLAG_DAO_COMMITTEE is active, feature-flag changes must go through
    // a passed DAO proposal — direct authority calls are blocked.
    require!(
        config.feature_flags & FLAG_DAO_COMMITTEE == 0,
        SssError::DaoCommitteeRequired
    );
    config.feature_flags |= flag;
    msg!(
        "Feature flag 0x{:016x} SET — flags now 0x{:016x}",
        flag,
        config.feature_flags
    );
    Ok(())
}

/// Clear a feature flag bit (turn the feature OFF).
pub fn clear_feature_flag_handler(
    ctx: Context<UpdateFeatureFlag>,
    flag: u64,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;
    // Same guard: DAO committee is active → must use the proposal flow.
    require!(
        config.feature_flags & FLAG_DAO_COMMITTEE == 0,
        SssError::DaoCommitteeRequired
    );
    config.feature_flags &= !flag;
    msg!(
        "Feature flag 0x{:016x} CLEARED — flags now 0x{:016x}",
        flag,
        config.feature_flags
    );
    Ok(())
}
