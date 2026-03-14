use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::state::StablecoinConfig;

/// Accounts for `redeem` (SSS-3 only).
/// Burns SSS tokens from the redeemer's account and releases collateral from the vault.
#[derive(Accounts)]
pub struct RedeemCtx<'info> {
    pub redeemer: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The SSS stablecoin mint
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// Redeemer's SSS stablecoin token account (will be burned from)
    #[account(
        mut,
        constraint = redeemer_sss_account.owner == redeemer.key(),
        constraint = redeemer_sss_account.mint == sss_mint.key(),
    )]
    pub redeemer_sss_account: InterfaceAccount<'info, TokenAccount>,

    /// The collateral token mint (e.g. USDC)
    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint,
        constraint = collateral_mint.decimals == sss_mint.decimals @ SssError::DecimalMismatch,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// Reserve vault — releases collateral to redeemer (PDA-controlled)
    #[account(
        mut,
        constraint = reserve_vault.key() == config.reserve_vault @ SssError::InvalidVault,
        constraint = reserve_vault.mint == collateral_mint.key(),
    )]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,

    /// Redeemer's collateral token account (receives collateral)
    #[account(
        mut,
        constraint = redeemer_collateral.owner == redeemer.key(),
        constraint = redeemer_collateral.mint == collateral_mint.key(),
    )]
    pub redeemer_collateral: InterfaceAccount<'info, TokenAccount>,

    /// Token program for the SSS stablecoin (Token-2022)
    pub sss_token_program: Interface<'info, TokenInterface>,

    /// Token program for the collateral mint (may be Token or Token-2022)
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn redeem_handler(ctx: Context<RedeemCtx>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);
    require!(
        ctx.accounts.reserve_vault.amount >= amount,
        SssError::InsufficientReserves
    );

    // 1. Burn SSS stablecoin tokens from redeemer (redeemer signs)
    spl_burn_checked(
        CpiContext::new(
            ctx.accounts.sss_token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.redeemer_sss_account.to_account_info(),
                authority: ctx.accounts.redeemer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.sss_mint.decimals,
    )?;

    // 2. Release collateral from vault → redeemer (config PDA signs)
    let sss_mint_key = ctx.accounts.sss_mint.key();
    let seeds = &[
        StablecoinConfig::SEED,
        sss_mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.collateral_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.redeemer_collateral.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    // 3. Update config state
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(amount).ok_or(SssError::Overflow)?;
    config.total_collateral = config.total_collateral.checked_sub(amount).ok_or(SssError::Underflow)?;

    msg!(
        "Redeemed {} SSS tokens for {} collateral. New collateral: {}",
        amount,
        amount,
        config.total_collateral
    );
    Ok(())
}
