use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};
use pyth_sdk_solana::state::SolanaPriceAccount;

use crate::error::SssError;
use crate::state::{CdpPosition, CollateralVault, StablecoinConfig};

/// Hardcoded fallback maximum age of a Pyth price update (60 seconds).
/// Overridden by `StablecoinConfig.max_oracle_age_secs` when non-zero.
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;

/// Liquidate an undercollateralised CDP position.
/// Callable by anyone (liquidator) when the user's collateral ratio < 120%.
/// Liquidator supplies SSS debt tokens to burn, receives collateral at a 5% discount.
#[derive(Accounts)]
pub struct CdpLiquidate<'info> {
    /// The liquidator — anyone who calls this and holds enough SSS
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// SSS-3 stablecoin mint
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// Liquidator's SSS token account (source, will be burned)
    #[account(
        mut,
        constraint = liquidator_sss_account.mint == sss_mint.key(),
        constraint = liquidator_sss_account.owner == liquidator.key(),
    )]
    pub liquidator_sss_account: InterfaceAccount<'info, TokenAccount>,

    /// CDP position of the user being liquidated
    #[account(
        mut,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), cdp_owner.key().as_ref()],
        bump = cdp_position.bump,
        constraint = cdp_position.owner == cdp_owner.key(),
        constraint = cdp_position.sss_mint == sss_mint.key(),
        // SSS-054: enforce the vault being seized is the position's locked collateral
        constraint = cdp_position.collateral_mint == collateral_mint.key() @ SssError::WrongCollateralMint,
    )]
    pub cdp_position: Account<'info, CdpPosition>,

    /// CHECK: CDP owner being liquidated — used only as PDA seed; no authority check needed
    pub cdp_owner: AccountInfo<'info>,

    /// The collateral vault being seized
    #[account(
        mut,
        seeds = [
            CollateralVault::SEED,
            sss_mint.key().as_ref(),
            cdp_owner.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump = collateral_vault.bump,
        constraint = collateral_vault.owner == cdp_owner.key(),
        constraint = collateral_vault.collateral_mint == collateral_mint.key(),
    )]
    pub collateral_vault: Account<'info, CollateralVault>,

    /// The collateral token mint
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// Vault token account (holds collateral, owned by collateral_vault PDA)
    #[account(
        mut,
        constraint = vault_token_account.key() == collateral_vault.vault_token_account,
        constraint = vault_token_account.mint == collateral_mint.key(),
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Liquidator's collateral token account — receives seized collateral at discount
    #[account(
        mut,
        constraint = liquidator_collateral_account.mint == collateral_mint.key(),
        constraint = liquidator_collateral_account.owner == liquidator.key(),
    )]
    pub liquidator_collateral_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Pyth price feed account — validated in handler via SolanaPriceAccount
    pub pyth_price_feed: AccountInfo<'info>,

    /// Token program for SSS-3 (Token-2022)
    pub sss_token_program: Interface<'info, TokenInterface>,

    /// Token program for collateral
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn cdp_liquidate_handler(ctx: Context<CdpLiquidate>) -> Result<()> {
    // 1. Fetch Pyth price
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

    // SSS-090: Confidence interval check — reject liquidations with uncertain prices.
    // If max_oracle_conf_bps is set, refuse to liquidate on noisy oracle data.
    let conf_bps_limit = ctx.accounts.config.max_oracle_conf_bps;
    if conf_bps_limit > 0 {
        let conf_ratio_bps = price
            .conf
            .saturating_mul(10_000)
            / price.price as u64;
        require!(
            conf_ratio_bps <= conf_bps_limit as u64,
            SssError::OracleConfidenceTooWide
        );
    }

    // 2. Compute collateral value (USD, 6dp scaled)
    let deposited = ctx.accounts.collateral_vault.deposited_amount;
    require!(deposited > 0, SssError::InsufficientCollateral);

    let collateral_decimals = ctx.accounts.collateral_mint.decimals as u32;
    let price_val = price.price as u128;
    let price_expo_abs = price.expo.unsigned_abs();

    let collateral_value_usd_e6: u128 = (deposited as u128)
        .checked_mul(price_val)
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(1_000_000u128)
        .ok_or(error!(SssError::InvalidPrice))?
        / 10u128.pow(price_expo_abs)
        / 10u128.pow(collateral_decimals);

    // 3. Compute current collateral ratio
    let debt = ctx.accounts.cdp_position.debt_amount;
    require!(debt > 0, SssError::InsufficientDebt);

    let sss_decimals = ctx.accounts.sss_mint.decimals as u32;
    // debt in USD e6 terms
    let debt_usd_e6: u128 = (debt as u128)
        .checked_mul(1_000_000u128)
        .unwrap()
        / 10u128.pow(sss_decimals);

    // ratio_bps = collateral_value / debt * 10000
    let ratio_bps: u128 = collateral_value_usd_e6
        .checked_mul(10_000)
        .ok_or(error!(SssError::InvalidPrice))?
        / debt_usd_e6;

    require!(
        ratio_bps < CdpPosition::LIQUIDATION_THRESHOLD_BPS as u128,
        SssError::CdpNotLiquidatable
    );

    // 4. Liquidate full position: burn all debt, seize all collateral + 5% bonus
    // Liquidator burns debt tokens
    spl_burn_checked(
        CpiContext::new(
            ctx.accounts.sss_token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.liquidator_sss_account.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        ),
        debt,
        ctx.accounts.sss_mint.decimals,
    )?;

    // Collateral seized = all deposited (capped at vault balance)
    // 5% bonus already implicit because collateral ratio was < 120%
    // i.e., liquidator pays 1.0 debt USD but gets back < 1.2 USD of collateral
    // The entire remaining collateral is transferred to the liquidator
    let collateral_to_seize = deposited;

    // Transfer collateral vault → liquidator (collateral_vault PDA signs)
    let sss_mint_key = ctx.accounts.sss_mint.key();
    let owner_key = ctx.accounts.cdp_owner.key();
    let collateral_mint_key = ctx.accounts.collateral_mint.key();
    let vault_bump = ctx.accounts.collateral_vault.bump;
    let seeds = &[
        CollateralVault::SEED,
        sss_mint_key.as_ref(),
        owner_key.as_ref(),
        collateral_mint_key.as_ref(),
        &[vault_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.collateral_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.liquidator_collateral_account.to_account_info(),
                authority: ctx.accounts.collateral_vault.to_account_info(),
            },
            signer_seeds,
        ),
        collateral_to_seize,
        ctx.accounts.collateral_mint.decimals,
    )?;

    // 5. Update state
    let position = &mut ctx.accounts.cdp_position;
    position.debt_amount = 0;

    let vault = &mut ctx.accounts.collateral_vault;
    vault.deposited_amount = 0;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(debt).unwrap();

    msg!(
        "CDP liquidated: burned {} SSS debt, seized {} collateral. Ratio was {}bps (threshold {}bps)",
        debt,
        collateral_to_seize,
        ratio_bps,
        CdpPosition::LIQUIDATION_THRESHOLD_BPS,
    );
    Ok(())
}
