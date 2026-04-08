use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::CdpRepaid;
use crate::state::{CdpPosition, CollateralConfig, CollateralVault, StablecoinConfig};

// BUG-012: cdp_repay_stable must settle accrued_fees before/during repayment.
// Repay flow: (1) burn accrued_fees first (fee settlement), (2) burn principal repay amount,
// (3) release proportional collateral based on remaining debt post-repay.

/// Repay SSS-3 stablecoin debt and release collateral proportionally.
/// Burns the repaid SSS from user's account and transfers collateral back.
#[derive(Accounts)]
pub struct CdpRepayStable<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS-3 stablecoin mint
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// User's SSS token account (source, will be burned)
    #[account(
        mut,
        constraint = user_sss_account.mint == sss_mint.key(),
        constraint = user_sss_account.owner == user.key(),
    )]
    pub user_sss_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The CDP position for this user
    #[account(
        mut,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), user.key().as_ref()],
        bump = cdp_position.bump,
        constraint = cdp_position.owner == user.key(),
        constraint = cdp_position.sss_mint == sss_mint.key(),
    )]
    pub cdp_position: Box<Account<'info, CdpPosition>>,

    /// The collateral vault for this user and collateral type
    #[account(
        mut,
        seeds = [
            CollateralVault::SEED,
            sss_mint.key().as_ref(),
            user.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump = collateral_vault.bump,
        constraint = collateral_vault.owner == user.key(),
        constraint = collateral_vault.collateral_mint == collateral_mint.key(),
    )]
    pub collateral_vault: Box<Account<'info, CollateralVault>>,

    /// The collateral token mint
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The vault token account holding collateral (owned by collateral_vault PDA)
    #[account(
        mut,
        constraint = vault_token_account.key() == collateral_vault.vault_token_account,
        constraint = vault_token_account.mint == collateral_mint.key(),
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's collateral token account to receive released collateral
    #[account(
        mut,
        constraint = user_collateral_account.mint == collateral_mint.key(),
        constraint = user_collateral_account.owner == user.key(),
    )]
    pub user_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Optional: CollateralConfig PDA for per-collateral params (SSS-098).
    /// When present, total_deposited is decremented on collateral release.
    #[account(
        mut,
        seeds = [CollateralConfig::SEED, sss_mint.key().as_ref(), collateral_mint.key().as_ref()],
        bump = collateral_config.bump,
    )]
    pub collateral_config: Option<Box<Account<'info, CollateralConfig>>>,

    /// Token program for SSS-3 (Token-2022)
    pub sss_token_program: Interface<'info, TokenInterface>,

    /// Token program for collateral (Token or Token-2022)
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn cdp_repay_stable_handler(ctx: Context<CdpRepayStable>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);
    require!(
        ctx.accounts.config.version >= crate::instructions::upgrade::MIN_SUPPORTED_VERSION,
        SssError::ConfigVersionTooOld
    );

    // NOTE: Repayment is allowed during pause — blocking repayment would
    // prevent users from reducing debt, worsening system health.

    let position = &ctx.accounts.cdp_position;
    let debt = position.debt_amount;
    let accrued_fees = position.accrued_fees;

    // BUG-012 CRIT-06: `amount` applies to principal debt only. accrued_fees are settled
    // separately below. Validate amount against principal debt.
    require!(debt >= amount, SssError::InsufficientDebt);

    // Proportional collateral release based on remaining PRINCIPAL debt post-repay.
    // (accrued_fees are settled but don't release proportional collateral — they represent
    //  protocol revenue already accounted for.)
    let deposited = ctx.accounts.collateral_vault.deposited_amount;
    let collateral_to_release = if debt > 0 {
        (deposited as u128)
            .checked_mul(amount as u128)
            .ok_or(error!(SssError::Overflow))?
            .checked_div(debt as u128)
            .unwrap_or(0) as u64
    } else {
        0
    };

    // BUG-012 CRIT-06: total burn = principal repay amount + any pending accrued_fees
    // This ensures accrued_fees cannot become phantom uncollectable debt.
    let total_burn = amount.checked_add(accrued_fees).ok_or(error!(SssError::InvalidAmount))?;

    // 1. Burn principal + accrued_fees from user
    spl_burn_checked(
        CpiContext::new(
            ctx.accounts.sss_token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.user_sss_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        total_burn,
        ctx.accounts.sss_mint.decimals,
    )?;

    // 2. Release collateral from vault → user (collateral_vault PDA signs)
    if collateral_to_release > 0 {
        let sss_mint_key = ctx.accounts.sss_mint.key();
        let user_key = ctx.accounts.user.key();
        let collateral_mint_key = ctx.accounts.collateral_mint.key();
        let bump = ctx.accounts.collateral_vault.bump;
        let seeds = &[
            CollateralVault::SEED,
            sss_mint_key.as_ref(),
            user_key.as_ref(),
            collateral_mint_key.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.collateral_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.user_collateral_account.to_account_info(),
                    authority: ctx.accounts.collateral_vault.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_to_release,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }

    // 3. Update state
    let position = &mut ctx.accounts.cdp_position;
    position.debt_amount = position.debt_amount.checked_sub(amount)
        .ok_or(error!(SssError::Overflow))?;
    // BUG-012 CRIT-06: reset accrued_fees to 0 — they have been burned above
    position.accrued_fees = 0;

    let vault = &mut ctx.accounts.collateral_vault;
    vault.deposited_amount = vault
        .deposited_amount
        .checked_sub(collateral_to_release)
        .ok_or(error!(SssError::Overflow))?;

    // Decrement CollateralConfig.total_deposited to keep the global counter accurate.
    if collateral_to_release > 0 {
        if let Some(cc) = ctx.accounts.collateral_config.as_mut() {
            cc.total_deposited = cc.total_deposited.checked_sub(collateral_to_release)
                .ok_or(error!(SssError::Overflow))?;
        }
    }

    let config = &mut ctx.accounts.config;
    // total_burned includes both principal and fees
    config.total_burned = config.total_burned.checked_add(total_burn)
        .ok_or(error!(SssError::Overflow))?;

    emit!(CdpRepaid {
        sss_mint: ctx.accounts.sss_mint.key(),
        user: ctx.accounts.user.key(),
        collateral_mint: ctx.accounts.collateral_mint.key(),
        amount_repaid: amount,
        collateral_released: collateral_to_release,
        remaining_debt: ctx.accounts.cdp_position.debt_amount,
    });

    msg!(
        "CDP: repaid {} SSS principal + {} fees settled. Released {} collateral. Remaining debt: {}",
        amount,
        accrued_fees,
        collateral_to_release,
        ctx.accounts.cdp_position.debt_amount,
    );
    Ok(())
}
