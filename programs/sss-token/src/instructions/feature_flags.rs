use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::StablecoinConfig;

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
    let config = &mut ctx.accounts.config;
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
    let config = &mut ctx.accounts.config;
    config.feature_flags &= !flag;
    msg!(
        "Feature flag 0x{:016x} CLEARED — flags now 0x{:016x}",
        flag,
        config.feature_flags
    );
    Ok(())
}
