use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{StablecoinConfig, FLAG_DAO_COMMITTEE};

#[derive(Accounts)]
pub struct Pause<'info> {
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

pub fn handler(ctx: Context<Pause>, paused: bool) -> Result<()> {
    // BUG-010: block direct pause/unpause when timelock is active.
    // Use propose_timelocked_op (op_kind=16 for pause, 17 for unpause) + execute.
    let op_kind = if paused {
        crate::state::ADMIN_OP_PAUSE
    } else {
        crate::state::ADMIN_OP_UNPAUSE
    };
    crate::instructions::admin_timelock::require_timelock_executed(
        &ctx.accounts.config,
        op_kind,
    )?;

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        ctx.accounts.config.feature_flags & FLAG_DAO_COMMITTEE == 0,
        SssError::DaoCommitteeRequired
    );
    ctx.accounts.config.paused = paused;
    msg!("Mint {} paused={} (no-timelock path)", ctx.accounts.mint.key(), paused);
    Ok(())
}
