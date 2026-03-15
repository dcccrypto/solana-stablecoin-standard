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
    require!(
        ctx.accounts.config.feature_flags & FLAG_DAO_COMMITTEE == 0,
        SssError::DaoCommitteeRequired
    );
    ctx.accounts.config.paused = paused;
    msg!("Mint {} paused={}", ctx.accounts.mint.key(), paused);
    Ok(())
}
