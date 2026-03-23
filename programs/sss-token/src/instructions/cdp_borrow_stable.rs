use anchor_lang::prelude::*;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};
use pyth_sdk_solana::state::SolanaPriceAccount;

use crate::error::SssError;
use crate::events::CdpBorrowed;
use crate::state::{CdpPosition, CollateralVault, StablecoinConfig, FLAG_CIRCUIT_BREAKER};

/// Hardcoded fallback maximum age of a Pyth price update (60 seconds).
/// Overridden by `StablecoinConfig.max_oracle_age_secs` when non-zero.
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;

/// Borrow SSS-3 stablecoins against deposited collateral.
/// Enforces minimum 150% collateral ratio using Pyth price feed.
#[derive(Accounts)]
pub struct CdpBorrowStable<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS-3 stablecoin mint (Token-2022, authority = config PDA)
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The collateral token mint for the vault being borrowed against
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// User's collateral vault for this specific collateral type
    #[account(
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

    /// CDP position — tracks total outstanding debt for this user
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + CdpPosition::INIT_SPACE,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub cdp_position: Box<Account<'info, CdpPosition>>,

    /// User's SSS token account to receive minted stablecoins
    #[account(
        mut,
        constraint = user_sss_account.mint == sss_mint.key(),
        constraint = user_sss_account.owner == user.key(),
    )]
    pub user_sss_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Pyth price feed account — validated in handler via SolanaPriceAccount
    pub pyth_price_feed: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[inline(never)]
pub fn cdp_borrow_stable_handler(ctx: Context<CdpBorrowStable>, amount: u64) -> Result<()> {
    // SSS-122: version guard
    require!(
        ctx.accounts.config.version >= crate::instructions::upgrade::MIN_SUPPORTED_VERSION,
        SssError::ConfigVersionTooOld
    );
    require!(amount > 0, SssError::ZeroAmount);
    // SSS-110: Circuit breaker — halt CDP borrows when FLAG_CIRCUIT_BREAKER is set.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // SSS-085 Fix 1: Validate Pyth feed Pubkey — reject unknown/spoofed price feeds.
    // If expected_pyth_feed is set (non-default), the provided account must match exactly.
    let expected_feed = ctx.accounts.config.expected_pyth_feed;
    if expected_feed != Pubkey::default() {
        require!(
            ctx.accounts.pyth_price_feed.key() == expected_feed,
            SssError::UnexpectedPriceFeed
        );
    }

    // 1. Read Pyth price
    let clock = Clock::get()?;
    let price_feed = SolanaPriceAccount::account_info_to_feed(
        &ctx.accounts.pyth_price_feed,
    )
    .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    // SSS-090: Use configurable max age (falls back to DEFAULT_MAX_PRICE_AGE_SECS when 0)
    let max_age_secs = if ctx.accounts.config.max_oracle_age_secs > 0 {
        ctx.accounts.config.max_oracle_age_secs as u64
    } else {
        DEFAULT_MAX_PRICE_AGE_SECS
    };

    let price = price_feed
        .get_price_no_older_than(clock.unix_timestamp, max_age_secs)
        .ok_or(error!(SssError::StalePriceFeed))?;

    require!(price.price > 0, SssError::InvalidPrice);

    // SSS-090: Confidence interval check — reject prices with excessive uncertainty.
    // If max_oracle_conf_bps is set (non-zero), reject when conf/price > threshold.
    let conf_bps_limit = ctx.accounts.config.max_oracle_conf_bps;
    if conf_bps_limit > 0 {
        // conf_ratio_bps = conf * 10_000 / price (price is positive, checked above)
        let conf_ratio_bps = price
            .conf
            .saturating_mul(10_000)
            / price.price as u64;
        require!(
            conf_ratio_bps <= conf_bps_limit as u64,
            SssError::OracleConfidenceTooWide
        );
    }

    // 2. Compute collateral USD value
    let deposited = ctx.accounts.collateral_vault.deposited_amount;
    require!(deposited > 0, SssError::InsufficientCollateral);

    let collateral_decimals = ctx.accounts.collateral_mint.decimals as u32;
    let price_val = price.price as u128;
    // Pyth expo is negative (e.g. -8 means price in 10^-8 USD per unit)
    let price_expo_abs = price.expo.unsigned_abs();

    // collateral_value in USD with 6dp scale:
    // = deposited * price_val * 1e6 / 10^price_expo_abs / 10^collateral_decimals
    let collateral_value_usd_e6: u128 = (deposited as u128)
        .checked_mul(price_val)
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(1_000_000u128)
        .ok_or(error!(SssError::InvalidPrice))?
        / 10u128.pow(price_expo_abs)
        / 10u128.pow(collateral_decimals);

    // 3. Max borrow at 150% ratio (in SSS token units, assuming 1 SSS = 1 USD)
    let sss_decimals = ctx.accounts.sss_mint.decimals as u32;
    let max_borrow_usd_e6 = collateral_value_usd_e6
        .checked_mul(10_000)
        .ok_or(error!(SssError::CollateralRatioTooLow))?
        / CdpPosition::MIN_COLLATERAL_RATIO_BPS as u128;

    // Convert USD e6 → SSS token units
    let max_borrow_sss = max_borrow_usd_e6
        .checked_mul(10u128.pow(sss_decimals))
        .ok_or(error!(SssError::CollateralRatioTooLow))?
        / 1_000_000u128;

    // SSS-113 HIGH-05: Use effective debt (principal + accrued fees) for ratio check.
    // Without accrued_fees, borrowers could over-borrow once fees pushed them past the limit.
    let existing_debt = ctx.accounts.cdp_position.debt_amount as u128;
    let accrued_fees = ctx.accounts.cdp_position.accrued_fees as u128;
    let effective_existing_debt = existing_debt.checked_add(accrued_fees).unwrap();
    let new_total_debt = effective_existing_debt.checked_add(amount as u128).unwrap();

    require!(
        new_total_debt <= max_borrow_sss,
        SssError::CollateralRatioTooLow
    );

    // 4. Mint SSS tokens to user (config PDA is mint authority)
    let sss_mint_key = ctx.accounts.sss_mint.key();
    let seeds = &[
        StablecoinConfig::SEED,
        sss_mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.sss_mint.to_account_info(),
                to: ctx.accounts.user_sss_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // 5. Update state
    let position = &mut ctx.accounts.cdp_position;
    if position.owner == Pubkey::default() {
        // First borrow: initialise position and lock in the collateral mint (SSS-054)
        position.config = ctx.accounts.config.key();
        position.sss_mint = ctx.accounts.sss_mint.key();
        position.owner = ctx.accounts.user.key();
        position.collateral_mint = ctx.accounts.collateral_mint.key();
        position.bump = ctx.bumps.cdp_position;
        // SSS-092: Seed last_fee_accrual to now so the first accrual interval starts fresh
        position.last_fee_accrual = clock.unix_timestamp;
        position.accrued_fees = 0;
    } else {
        // Subsequent borrows: enforce single-collateral constraint (SSS-054)
        require!(
            position.collateral_mint == ctx.accounts.collateral_mint.key(),
            SssError::WrongCollateralMint,
        );
    }
    position.debt_amount = position.debt_amount.checked_add(amount).unwrap();

    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted.checked_add(amount).unwrap();

    emit!(CdpBorrowed {
        sss_mint: ctx.accounts.sss_mint.key(),
        user: ctx.accounts.user.key(),
        collateral_mint: ctx.accounts.collateral_mint.key(),
        amount_borrowed: amount,
        total_debt: ctx.accounts.cdp_position.debt_amount,
    });

    msg!(
        "CDP: borrowed {} SSS. Total debt: {}. Max allowed: {}",
        amount,
        ctx.accounts.cdp_position.debt_amount,
        max_borrow_sss,
    );
    Ok(())
}
