use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SssError;
use crate::events::{StablecoinPaused, StablecoinUnpaused};
use crate::state::{RoleEntry, StablecoinConfig};

pub fn pause(ctx: Context<PauseCtx>) -> Result<()> {
    require!(!ctx.accounts.config.paused, SssError::AlreadyPaused);
    ctx.accounts.config.paused = true;

    emit_cpi!(StablecoinPaused {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.pauser.key(),
    });
    Ok(())
}

pub fn unpause(ctx: Context<UnpauseCtx>) -> Result<()> {
    require!(ctx.accounts.config.paused, SssError::NotPaused);
    ctx.accounts.config.paused = false;

    emit_cpi!(StablecoinUnpaused {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.pauser.key(),
    });
    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct PauseCtx<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), pauser.key().as_ref(), &[ROLE_PAUSER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,
}

#[derive(Accounts)]
#[event_cpi]
pub struct UnpauseCtx<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), pauser.key().as_ref(), &[ROLE_PAUSER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,
}
