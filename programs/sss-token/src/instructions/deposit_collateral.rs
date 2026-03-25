use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::state::StablecoinConfig;

/// Accounts for `deposit_collateral` (SSS-3 only).
#[derive(Accounts)]
pub struct DepositCollateralCtx<'info> {
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS stablecoin mint (identifies which config to update)
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// The collateral token mint (e.g. USDC)
    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// Depositor's collateral token account (source)
    #[account(
        mut,
        constraint = depositor_collateral.owner == depositor.key(),
        constraint = depositor_collateral.mint == collateral_mint.key(),
    )]
    pub depositor_collateral: InterfaceAccount<'info, TokenAccount>,

    /// The reserve vault — holds collateral on behalf of the stablecoin config PDA
    #[account(
        mut,
        constraint = reserve_vault.key() == config.reserve_vault @ SssError::InvalidVault,
        constraint = reserve_vault.mint == collateral_mint.key(),
    )]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn deposit_collateral_handler(ctx: Context<DepositCollateralCtx>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    // Transfer collateral from depositor → reserve vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.depositor_collateral.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.reserve_vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    ctx.accounts.config.total_collateral = ctx
        .accounts
        .config
        .total_collateral
        .checked_add(amount)
        .unwrap();

    msg!(
        "Deposited {} collateral. Vault total: {}",
        amount,
        ctx.accounts.config.total_collateral
    );
    Ok(())
}
