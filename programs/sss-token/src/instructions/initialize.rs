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

    /// The new Token-2022 mint — authority is the config PDA so the program controls minting
    #[account(
        init,
        payer = payer,
        mint::decimals = params.decimals,
        mint::authority = config,
        mint::freeze_authority = config,
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
    require!(
        params.preset == 1 || params.preset == 2 || params.preset == 3,
        SssError::InvalidPreset
    );
    if params.preset == 2 {
        require!(params.transfer_hook_program.is_some(), SssError::MissingTransferHook);
    }
    if params.preset == 3 {
        require!(params.collateral_mint.is_some(), SssError::InvalidCollateralMint);
        require!(params.reserve_vault.is_some(), SssError::InvalidVault);
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
    config.collateral_mint = params.collateral_mint.unwrap_or_default();
    config.reserve_vault = params.reserve_vault.unwrap_or_default();
    config.total_collateral = 0;
    config.bump = ctx.bumps.config;

    msg!(
        "SSS-{} initialized: mint={} authority={}",
        params.preset,
        config.mint,
        config.authority
    );

    Ok(())
}
