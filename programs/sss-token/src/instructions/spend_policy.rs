use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{FLAG_SPEND_POLICY, StablecoinConfig};

// ---------------------------------------------------------------------------
// Shared account context — authority sets or clears the spend limit
// ---------------------------------------------------------------------------
#[derive(Accounts)]
pub struct UpdateSpendLimit<'info> {
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

/// Set the per-tx spend limit and enable FLAG_SPEND_POLICY.
///
/// `max_amount` must be > 0.  The flag is set atomically so callers can
/// never be left in a half-configured state.
pub fn set_spend_limit_handler(
    ctx: Context<UpdateSpendLimit>,
    max_amount: u64,
) -> Result<()> {
    require!(max_amount > 0, SssError::SpendPolicyNotConfigured);

    let config = &mut ctx.accounts.config;
    config.max_transfer_amount = max_amount;
    config.feature_flags |= FLAG_SPEND_POLICY;

    msg!(
        "SpendPolicy SET — max_transfer_amount={} flags=0x{:016x}",
        max_amount,
        config.feature_flags
    );
    Ok(())
}

/// Clear the spend limit and disable FLAG_SPEND_POLICY.
///
/// Sets `max_transfer_amount` back to 0 (unconfigured) and clears the flag.
pub fn clear_spend_limit_handler(ctx: Context<UpdateSpendLimit>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.feature_flags &= !FLAG_SPEND_POLICY;
    config.max_transfer_amount = 0;

    msg!(
        "SpendPolicy CLEARED — flags=0x{:016x}",
        config.feature_flags
    );
    Ok(())
}
