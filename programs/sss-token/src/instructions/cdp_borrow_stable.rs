use anchor_lang::prelude::*;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};
use pyth_sdk_solana::state::SolanaPriceAccount;

use crate::error::SssError;
use crate::state::{CdpPosition, CollateralVault, StablecoinConfig};

/// Maximum age of a Pyth price update (60 seconds)
const MAX_PRICE_AGE_SECS: i64 = 60;

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
    pub config: Account<'info, StablecoinConfig>,

    /// The SSS-3 stablecoin mint (Token-2022, authority = config PDA)
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// The collateral token mint for the vault being borrowed against
    pub collateral_mint: InterfaceAccount<'info, Mint>,

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
    pub collateral_vault: Account<'info, CollateralVault>,

    /// CDP position — tracks total outstanding debt for this user
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + CdpPosition::INIT_SPACE,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub cdp_position: Account<'info, CdpPosition>,

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

pub fn cdp_borrow_stable_handler(ctx: Context<CdpBorrowStable>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    // 1. Read Pyth price
    let clock = Clock::get()?;
    let price_feed = SolanaPriceAccount::account_info_to_feed(
        &ctx.accounts.pyth_price_feed,
    )
    .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    let price = price_feed
        .get_price_no_older_than(clock.unix_timestamp, MAX_PRICE_AGE_SECS as u64)
        .ok_or(error!(SssError::StalePriceFeed))?;

    require!(price.price > 0, SssError::InvalidPrice);

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

    // Check new total debt won't exceed max
    let existing_debt = ctx.accounts.cdp_position.debt_amount as u128;
    let new_total_debt = existing_debt.checked_add(amount as u128).unwrap();

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
        position.config = ctx.accounts.config.key();
        position.sss_mint = ctx.accounts.sss_mint.key();
        position.owner = ctx.accounts.user.key();
        position.bump = ctx.bumps.cdp_position;
    }
    position.debt_amount = position.debt_amount.checked_add(amount).unwrap();

    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted.checked_add(amount).unwrap();

    msg!(
        "CDP: borrowed {} SSS. Total debt: {}. Max allowed: {}",
        amount,
        position.debt_amount,
        max_borrow_sss,
    );
    Ok(())
}
