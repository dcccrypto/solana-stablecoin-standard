use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{InitializeParams, StablecoinConfig};

#[derive(Accounts)]
#[instruction(params: InitializeParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The new Token-2022 mint
    #[account(
        init,
        payer = payer,
        mint::decimals = params.decimals,
        mint::authority = payer.key(),
        mint::freeze_authority = payer.key(),
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Config PDA
    #[account(
        init,
        payer = payer,
        space = 8 + StablecoinConfig::INIT_SPACE,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(params.preset == 1 || params.preset == 2, SssError::InvalidPreset);
    if params.preset == 2 {
        require!(params.transfer_hook_program.is_some(), SssError::MissingTransferHook);
    }

    let config = &mut ctx.accounts.config;
    config.mint = ctx.accounts.mint.key();
    config.authority = ctx.accounts.payer.key();
    config.compliance_authority = ctx.accounts.payer.key();
    config.preset = params.preset;
    config.paused = false;
    config.total_minted = 0;
    config.total_burned = 0;
    config.transfer_hook_program = params.transfer_hook_program.unwrap_or_default();
    config.bump = ctx.bumps.config;

    msg!(
        "SSS-{} initialized: mint={} authority={}",
        params.preset,
        config.mint,
        config.authority
    );

    Ok(())
}
