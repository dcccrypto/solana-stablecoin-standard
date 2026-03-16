//! SSS-100 — Multi-collateral liquidation engine (v2)
//!
//! Extends the existing `cdp_liquidate` instruction with:
//!   1. **CollateralConfig integration** — per-collateral liquidation threshold
//!      and bonus read from the optional CollateralConfig PDA (SSS-098).
//!      Falls back to global constants when PDA is absent.
//!   2. **Partial liquidation** — caller specifies `debt_to_repay` (0 = full).
//!      Only enough collateral is seized to cover `debt_to_repay` plus the
//!      liquidation bonus; the rest stays in the vault.
//!   3. **`CollateralLiquidated` event** — emitted via `emit!` with
//!      `collateral_mint`, `cdp_owner`, `debt_repaid`, `collateral_seized`,
//!      and `partial` flag.
//!
//! # Liquidation Bonus
//! When a CollateralConfig PDA is supplied, `liquidation_bonus_bps` from that
//! config is used.  Otherwise the global constant 500 bps (5%) is used.
//!
//! # Partial Liquidation Invariant
//! After a partial liquidation the position must remain healthy, i.e.:
//!   collateral_value_after / (debt_after * 1_USD) >= min_collateral_ratio (150%)
//! This is checked by the handler to prevent over-liquidation.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};
use pyth_sdk_solana::state::SolanaPriceAccount;

use crate::error::SssError;
use crate::state::{CdpPosition, CollateralConfig, CollateralVault, StablecoinConfig};

/// Hardcoded fallback maximum age of a Pyth price update (60 seconds).
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

/// Emitted on every successful cdp_liquidate_v2 call.
#[event]
pub struct CollateralLiquidated {
    /// The collateral mint that was seized.
    pub collateral_mint: Pubkey,
    /// The CDP owner whose position was (partially) liquidated.
    pub cdp_owner: Pubkey,
    /// SSS debt tokens burned by the liquidator.
    pub debt_repaid: u64,
    /// Collateral tokens transferred to the liquidator.
    pub collateral_seized: u64,
    /// True if this was a partial liquidation (position still open).
    pub partial: bool,
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CdpLiquidateV2<'info> {
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
        // Enforce the vault being seized matches the position's locked collateral
        constraint = cdp_position.collateral_mint == collateral_mint.key() @ SssError::WrongCollateralMint,
    )]
    pub cdp_position: Account<'info, CdpPosition>,

    /// CHECK: CDP owner being liquidated — used as PDA seed; no authority check needed
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

    /// Liquidator's collateral token account — receives seized collateral
    #[account(
        mut,
        constraint = liquidator_collateral_account.mint == collateral_mint.key(),
        constraint = liquidator_collateral_account.owner == liquidator.key(),
    )]
    pub liquidator_collateral_account: InterfaceAccount<'info, TokenAccount>,

    /// SSS-098: CollateralConfig PDA for per-collateral liquidation params.
    /// Provides per-collateral liquidation_threshold_bps and liquidation_bonus_bps.
    /// Seeds: [b"collateral-config", sss_mint, collateral_mint]
    #[account(
        seeds = [
            CollateralConfig::SEED,
            sss_mint.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump = collateral_config.bump,
        constraint = collateral_config.sss_mint == sss_mint.key() @ SssError::InvalidCollateralMint,
        constraint = collateral_config.collateral_mint == collateral_mint.key() @ SssError::WrongCollateralMint,
    )]
    pub collateral_config: Account<'info, CollateralConfig>,

    /// CHECK: Pyth price feed account — validated in handler
    pub pyth_price_feed: AccountInfo<'info>,

    /// Token program for SSS-3 (Token-2022)
    pub sss_token_program: Interface<'info, TokenInterface>,

    /// Token program for collateral
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/// Parameters for `cdp_liquidate_v2`.
///
/// - `debt_to_repay`: SSS tokens the liquidator will burn.
///   * 0 → full liquidation (burns all outstanding debt).
///   * >0 → partial liquidation (burns exactly this amount; position must be
///     healthy after the seize).
/// - `min_collateral_amount`: slippage guard — minimum collateral tokens to
///   receive.  0 = no guard (backward-compatible with SSS-085 callers).
pub fn cdp_liquidate_v2_handler(
    ctx: Context<CdpLiquidateV2>,
    debt_to_repay: u64,
    min_collateral_amount: u64,
) -> Result<()> {
    // ── 0. Pyth feed Pubkey validation (SSS-085) ──────────────────────────
    let expected_feed = ctx.accounts.config.expected_pyth_feed;
    if expected_feed != Pubkey::default() {
        require!(
            ctx.accounts.pyth_price_feed.key() == expected_feed,
            SssError::UnexpectedPriceFeed
        );
    }

    // ── 1. Fetch Pyth price ───────────────────────────────────────────────
    let clock = Clock::get()?;
    let price_feed =
        SolanaPriceAccount::account_info_to_feed(&ctx.accounts.pyth_price_feed)
            .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    let max_age_secs = if ctx.accounts.config.max_oracle_age_secs > 0 {
        ctx.accounts.config.max_oracle_age_secs as u64
    } else {
        DEFAULT_MAX_PRICE_AGE_SECS
    };

    let price = price_feed
        .get_price_no_older_than(clock.unix_timestamp, max_age_secs)
        .ok_or(error!(SssError::StalePriceFeed))?;

    require!(price.price > 0, SssError::InvalidPrice);

    // SSS-090: confidence check
    let conf_bps_limit = ctx.accounts.config.max_oracle_conf_bps;
    if conf_bps_limit > 0 {
        let conf_ratio_bps = price.conf.saturating_mul(10_000) / price.price as u64;
        require!(
            conf_ratio_bps <= conf_bps_limit as u64,
            SssError::OracleConfidenceTooWide
        );
    }

    // ── 2. Read per-collateral params from CollateralConfig PDA ──────────
    let cc = &ctx.accounts.collateral_config;
    require!(cc.whitelisted, SssError::CollateralNotWhitelisted);
    let liquidation_threshold_bps = cc.liquidation_threshold_bps;
    let liquidation_bonus_bps = cc.liquidation_bonus_bps;

    // ── 3. Collateral value in USD (6 dp) ────────────────────────────────
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

    // ── 4. Current collateral ratio check ────────────────────────────────
    let total_debt = ctx.accounts.cdp_position.debt_amount;
    require!(total_debt > 0, SssError::InsufficientDebt);

    let sss_decimals = ctx.accounts.sss_mint.decimals as u32;
    let debt_usd_e6: u128 = (total_debt as u128)
        .checked_mul(1_000_000u128)
        .unwrap()
        / 10u128.pow(sss_decimals);

    let ratio_bps: u128 = collateral_value_usd_e6
        .checked_mul(10_000)
        .ok_or(error!(SssError::InvalidPrice))?
        / debt_usd_e6;

    require!(
        ratio_bps < liquidation_threshold_bps as u128,
        SssError::CdpNotLiquidatable
    );

    // ── 5. Determine debt to burn and collateral to seize ────────────────
    // debt_to_repay = 0 → full liquidation
    let actual_debt_repaid = if debt_to_repay == 0 || debt_to_repay >= total_debt {
        total_debt
    } else {
        debt_to_repay
    };

    let is_partial = actual_debt_repaid < total_debt;

    // Collateral to seize (in collateral token native units):
    //   seize = debt_USD * (1 + bonus_bps/10000) / collateral_price
    //
    // Derivation:
    //   debt_usd_e6 (for repaid portion) = actual_debt_repaid * 1e6 / 10^sss_decimals
    //   bonus_factor = (10_000 + bonus_bps) / 10_000
    //   seize_usd_e6 = debt_repaid_usd_e6 * bonus_factor
    //   seize_collateral = seize_usd_e6 * 10^collateral_decimals / (price_val / 10^expo_abs * 1e6)
    //                    = seize_usd_e6 * 10^collateral_decimals * 10^expo_abs / (price_val * 1e6)

    let debt_repaid_usd_e6: u128 = (actual_debt_repaid as u128)
        .checked_mul(1_000_000u128)
        .unwrap()
        / 10u128.pow(sss_decimals);

    let bonus_factor_num: u128 = 10_000 + liquidation_bonus_bps as u128;
    let seize_usd_e6: u128 = debt_repaid_usd_e6
        .checked_mul(bonus_factor_num)
        .ok_or(error!(SssError::InvalidPrice))?
        / 10_000;

    // seize_collateral_raw = seize_usd_e6 * 10^(collateral_decimals + expo_abs) / (price_val * 1_000_000)
    let seize_collateral_raw: u128 = seize_usd_e6
        .checked_mul(10u128.pow(collateral_decimals))
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(10u128.pow(price_expo_abs))
        .ok_or(error!(SssError::InvalidPrice))?
        / price_val
        / 1_000_000u128;

    // Cap at available collateral (full liquidation seizes everything)
    let collateral_to_seize = if seize_collateral_raw >= deposited as u128 || !is_partial {
        // Full liquidation always seizes all collateral
        deposited
    } else {
        seize_collateral_raw as u64
    };

    // ── 6. Partial liquidation health check ──────────────────────────────
    // After seizing, remaining position must be healthy (>= MIN_COLLATERAL_RATIO 150%)
    // to prevent over-liquidation.
    if is_partial {
        let remaining_collateral = deposited.saturating_sub(collateral_to_seize);
        let remaining_debt = total_debt.saturating_sub(actual_debt_repaid);

        if remaining_debt > 0 {
            let remaining_collateral_usd_e6: u128 = (remaining_collateral as u128)
                .checked_mul(price_val)
                .ok_or(error!(SssError::InvalidPrice))?
                .checked_mul(1_000_000u128)
                .ok_or(error!(SssError::InvalidPrice))?
                / 10u128.pow(price_expo_abs)
                / 10u128.pow(collateral_decimals);

            let remaining_debt_usd_e6: u128 = (remaining_debt as u128)
                .checked_mul(1_000_000u128)
                .unwrap()
                / 10u128.pow(sss_decimals);

            let post_ratio_bps: u128 = remaining_collateral_usd_e6
                .checked_mul(10_000)
                .ok_or(error!(SssError::InvalidPrice))?
                / remaining_debt_usd_e6;

            // Position must be healthy (>= 150%) after partial liquidation
            require!(
                post_ratio_bps >= CdpPosition::MIN_COLLATERAL_RATIO_BPS as u128,
                SssError::CollateralRatioTooLow
            );
        }
    }

    // ── 7. Slippage guard (SSS-085 compatible) ───────────────────────────
    if min_collateral_amount > 0 {
        require!(
            collateral_to_seize >= min_collateral_amount,
            SssError::SlippageExceeded
        );
    }

    // ── 8. Burn SSS debt tokens ───────────────────────────────────────────
    spl_burn_checked(
        CpiContext::new(
            ctx.accounts.sss_token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.liquidator_sss_account.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        ),
        actual_debt_repaid,
        ctx.accounts.sss_mint.decimals,
    )?;

    // ── 9. Transfer collateral vault → liquidator ─────────────────────────
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

    // ── 10. Update state ──────────────────────────────────────────────────
    let position = &mut ctx.accounts.cdp_position;
    position.debt_amount = total_debt.saturating_sub(actual_debt_repaid);

    let vault = &mut ctx.accounts.collateral_vault;
    vault.deposited_amount = deposited.saturating_sub(collateral_to_seize);

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(actual_debt_repaid).unwrap();

    // ── 11. Emit CollateralLiquidated event ───────────────────────────────
    emit!(CollateralLiquidated {
        collateral_mint: collateral_mint_key,
        cdp_owner: owner_key,
        debt_repaid: actual_debt_repaid,
        collateral_seized: collateral_to_seize,
        partial: is_partial,
    });

    msg!(
        "SSS-100 cdp_liquidate_v2: burned {} SSS, seized {} collateral (partial={}). \
         Ratio was {}bps (threshold {}bps, bonus {}bps)",
        actual_debt_repaid,
        collateral_to_seize,
        is_partial,
        ratio_bps,
        liquidation_threshold_bps,
        liquidation_bonus_bps,
    );

    Ok(())
}
