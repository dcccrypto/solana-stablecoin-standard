use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{MinterInfo, StablecoinConfig};

#[derive(Accounts)]
#[instruction(cap: u64)]
pub struct UpdateMinter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Validated as minter pubkey
    pub minter: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MinterInfo::INIT_SPACE,
        seeds = [MinterInfo::SEED, config.key().as_ref(), minter.key().as_ref()],
        bump,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UpdateMinter>, cap: u64) -> Result<()> {
    let minter_info = &mut ctx.accounts.minter_info;
    minter_info.config = ctx.accounts.config.key();
    minter_info.minter = ctx.accounts.minter.key();
    minter_info.cap = cap;
    if minter_info.bump == 0 {
        minter_info.bump = ctx.bumps.minter_info;
    }
    msg!(
        "Minter {} registered/updated with cap={}",
        ctx.accounts.minter.key(),
        cap
    );
    Ok(())
}
