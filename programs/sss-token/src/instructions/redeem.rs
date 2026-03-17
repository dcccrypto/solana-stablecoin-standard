use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::PsmSwapEvent;
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
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS stablecoin mint
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Redeemer's SSS stablecoin token account (will be burned from)
    #[account(
        mut,
        constraint = redeemer_sss_account.owner == redeemer.key(),
        constraint = redeemer_sss_account.mint == sss_mint.key(),
    )]
    pub redeemer_sss_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The collateral token mint (e.g. USDC)
    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint,
    )]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Reserve vault — releases collateral to redeemer (PDA-controlled)
    #[account(
        mut,
        constraint = reserve_vault.key() == config.reserve_vault @ SssError::InvalidVault,
        constraint = reserve_vault.mint == collateral_mint.key(),
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Redeemer's collateral token account (receives collateral)
    #[account(
        mut,
        constraint = redeemer_collateral.owner == redeemer.key(),
        constraint = redeemer_collateral.mint == collateral_mint.key(),
    )]
    pub redeemer_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

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

    // 1. Compute PSM fee (stays in vault; redeemer receives amount - fee).
    let fee_bps = ctx.accounts.config.redemption_fee_bps as u64;
    let fee_amount = if fee_bps > 0 {
        amount.saturating_mul(fee_bps) / 10_000
    } else {
        0
    };
    let collateral_out = amount.checked_sub(fee_amount).unwrap();
    require!(
        ctx.accounts.reserve_vault.amount >= amount,
        SssError::InsufficientReserves
    );

    // 2. Burn SSS stablecoin tokens from redeemer (redeemer signs)
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

    // 3. Release (amount - fee) collateral from vault → redeemer (config PDA signs)
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
        collateral_out,
        ctx.accounts.collateral_mint.decimals,
    )?;

    // 4. Update config state: burn decreases supply; fee stays in vault.
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(amount).unwrap();
    // Only the collateral that left the vault reduces total_collateral.
    config.total_collateral = config.total_collateral.checked_sub(collateral_out).unwrap();

    emit!(PsmSwapEvent {
        mint: config.mint,
        redeemer: ctx.accounts.redeemer.key(),
        sss_burned: amount,
        collateral_out,
        fee_collected: fee_amount,
        fee_bps: fee_bps as u16,
    });

    msg!(
        "Redeemed {} SSS tokens; collateral_out={} fee={} ({}bps). Vault: {}",
        amount,
        collateral_out,
        fee_amount,
        fee_bps,
        config.total_collateral
    );
    Ok(())
}
