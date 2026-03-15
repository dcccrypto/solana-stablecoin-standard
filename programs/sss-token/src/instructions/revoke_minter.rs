use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{MinterInfo, StablecoinConfig, FLAG_DAO_COMMITTEE};

#[derive(Accounts)]
pub struct RevokeMinter<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: validated via PDA seeds
    pub minter: AccountInfo<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [MinterInfo::SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<RevokeMinter>) -> Result<()> {
    // When FLAG_DAO_COMMITTEE is set, minter revocation must go through a passed proposal.
    require!(
        ctx.accounts.config.feature_flags & FLAG_DAO_COMMITTEE == 0,
        SssError::DaoCommitteeRequired
    );
    msg!("Revoked minter {}", ctx.accounts.minter.key());
    Ok(())
}
