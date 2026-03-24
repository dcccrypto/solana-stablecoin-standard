use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::{CdpLiquidated, CollateralLiquidated};
use crate::oracle;
use crate::state::{CdpPosition, CollateralConfig, CollateralVault, StablecoinConfig, FLAG_CIRCUIT_BREAKER};

/// Global fallback liquidation bonus (5%) when no CollateralConfig is provided.
const DEFAULT_LIQUIDATION_BONUS_BPS: u16 = 500;

/// Params for the `cdp_liquidate` instruction.
///
/// - `min_collateral_amount`: slippage protection — reverts if less collateral
///   would be received.  Pass 0 for no protection (backward-compatible).
/// - `partial_repay_amount`: when > 0, only this many debt tokens are burned and
///   just enough collateral to cover them (plus bonus) is seized.  When 0 the
///   entire debt is burned (full liquidation).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CdpLiquidateParams {
    pub min_collateral_amount: u64,
    pub partial_repay_amount: u64,
}

/// Liquidate an undercollateralised CDP position.
/// Callable by anyone (liquidator) when the user's collateral ratio < liquidation threshold.
///
/// SSS-100: Extended with:
///   - Optional `collateral_config` account — uses per-collateral threshold/bonus when present.
///   - Partial liquidation via `partial_repay_amount`.
///   - Emits `CollateralLiquidated` event on every liquidation.
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
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// SSS-3 stablecoin mint
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Liquidator's SSS token account (source, will be burned)
    #[account(
        mut,
        constraint = liquidator_sss_account.mint == sss_mint.key(),
        constraint = liquidator_sss_account.owner == liquidator.key(),
    )]
    pub liquidator_sss_account: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub cdp_position: Box<Account<'info, CdpPosition>>,

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
    pub collateral_vault: Box<Account<'info, CollateralVault>>,

    /// The collateral token mint
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Vault token account (holds collateral, owned by collateral_vault PDA)
    #[account(
        mut,
        constraint = vault_token_account.key() == collateral_vault.vault_token_account,
        constraint = vault_token_account.mint == collateral_mint.key(),
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Liquidator's collateral token account — receives seized collateral at discount
    #[account(
        mut,
        constraint = liquidator_collateral_account.mint == collateral_mint.key(),
        constraint = liquidator_collateral_account.owner == liquidator.key(),
    )]
    pub liquidator_collateral_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Pyth price feed account — validated in handler via SolanaPriceAccount
    pub pyth_price_feed: AccountInfo<'info>,

    /// SSS-100: Optional per-collateral configuration PDA.
    /// When provided, overrides the global liquidation threshold and bonus.
    /// Seeds: [b"collateral-config", sss_mint, collateral_mint]
    #[account(
        seeds = [
            CollateralConfig::SEED,
            sss_mint.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump = collateral_config.bump,
        constraint = collateral_config.sss_mint == sss_mint.key() @ SssError::Unauthorized,
        constraint = collateral_config.collateral_mint == collateral_mint.key() @ SssError::WrongCollateralMint,
    )]
    pub collateral_config: Option<Box<Account<'info, CollateralConfig>>>,

    /// Token program for SSS-3 (Token-2022)
    pub sss_token_program: Interface<'info, TokenInterface>,

    /// Token program for collateral
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn cdp_liquidate_handler(ctx: Context<CdpLiquidate>, params: CdpLiquidateParams) -> Result<()> {
    let min_collateral_amount = params.min_collateral_amount;
    let partial_repay_amount = params.partial_repay_amount;

    // SSS-110: Circuit breaker — halt liquidations when FLAG_CIRCUIT_BREAKER is set.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // SSS-119: Oracle abstraction — dispatch to the configured adapter.
    let clock = Clock::get()?;
    let oracle_price = oracle::get_oracle_price(
        &ctx.accounts.pyth_price_feed,
        &ctx.accounts.config,
        &clock,
    )?;

    // 2. Compute collateral value (USD, 6dp scaled)
    let deposited = ctx.accounts.collateral_vault.deposited_amount;
    require!(deposited > 0, SssError::InsufficientCollateral);

    let collateral_decimals = ctx.accounts.collateral_mint.decimals as u32;
    let price_val = oracle_price.price as u128;
    let price_expo_abs = oracle_price.expo.unsigned_abs();

    let collateral_value_usd_e6: u128 = (deposited as u128)
        .checked_mul(price_val)
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(1_000_000u128)
        .ok_or(error!(SssError::InvalidPrice))?
        / 10u128.pow(price_expo_abs)
        / 10u128.pow(collateral_decimals);

    // 3. Compute current collateral ratio and check liquidatability
    // SSS-113 HIGH-05: Use effective debt (principal + accrued fees) for ratio and liquidation.
    let debt = ctx.accounts.cdp_position.debt_amount;
    let accrued_fees = ctx.accounts.cdp_position.accrued_fees;
    let effective_debt = debt.checked_add(accrued_fees).unwrap_or(debt);
    require!(effective_debt > 0, SssError::InsufficientDebt);

    let sss_decimals = ctx.accounts.sss_mint.decimals as u32;
    let debt_usd_e6: u128 = (effective_debt as u128)
        .checked_mul(1_000_000u128)
        .unwrap()
        / 10u128.pow(sss_decimals);

    // ratio_bps = collateral_value / debt * 10000
    let ratio_bps: u128 = collateral_value_usd_e6
        .checked_mul(10_000)
        .ok_or(error!(SssError::InvalidPrice))?
        / debt_usd_e6;

    // SSS-100: Use per-collateral threshold from CollateralConfig when available,
    // otherwise fall back to global CdpPosition::LIQUIDATION_THRESHOLD_BPS.
    let (liquidation_threshold_bps, bonus_bps) = if let Some(cc) = &ctx.accounts.collateral_config {
        (cc.liquidation_threshold_bps as u128, cc.liquidation_bonus_bps)
    } else {
        (
            CdpPosition::LIQUIDATION_THRESHOLD_BPS as u128,
            DEFAULT_LIQUIDATION_BONUS_BPS,
        )
    };

    require!(
        ratio_bps < liquidation_threshold_bps,
        SssError::CdpNotLiquidatable
    );

    // 4. Determine debt to burn and collateral to seize.
    //
    // Full liquidation: burn all debt (principal + fees), seize all collateral.
    // Partial liquidation: burn `partial_repay_amount`, seize exactly
    //   enough collateral (at market price + bonus) to cover that debt.
    //   After the partial liquidation the ratio must be >= healthy (120% == 12000 bps).
    // SSS-113 HIGH-05: Use effective_debt (includes accrued fees) as the total debt basis.
    let is_partial = partial_repay_amount > 0 && partial_repay_amount < effective_debt;

    let (debt_to_burn, collateral_to_seize) = if is_partial {
        let repay = partial_repay_amount;
        require!(repay <= effective_debt, SssError::InvalidAmount);

        // Collateral equivalent to the repaid debt, scaled by bonus
        // collateral_for_repay = repay_usd_e6 * 10^coll_decimals / (price * 10^(6 - expo_abs)) * (10000 + bonus) / 10000
        let repay_usd_e6: u128 = (repay as u128)
            .checked_mul(1_000_000u128)
            .unwrap()
            / 10u128.pow(sss_decimals);

        // collateral_amount = repay_usd_e6 * 10^coll_decimals * (10000 + bonus_bps) / (price_val * 10^(6 - expo_abs) * 10000)
        // We keep the full formula in u128 to avoid overflow:
        let bonus_factor = 10_000u128 + bonus_bps as u128;
        let coll_amount_raw: u128 = repay_usd_e6
            .checked_mul(10u128.pow(collateral_decimals))
            .ok_or(error!(SssError::InvalidPrice))?
            .checked_mul(bonus_factor)
            .ok_or(error!(SssError::InvalidPrice))?
            / price_val
            / 10u128.pow(price_expo_abs.saturating_sub(6))
            / 10_000u128;

        // Clamp to available collateral (can't seize more than exists)
        let coll_to_seize = coll_amount_raw.min(deposited as u128) as u64;

        // Verify the remaining position would be healthy (>= 12000 bps = 120%).
        // If remaining_debt == 0 treat as full liquidation path.
        let remaining_debt = effective_debt.saturating_sub(repay);
        if remaining_debt > 0 {
            let remaining_collateral = deposited.saturating_sub(coll_to_seize);
            let remaining_coll_value: u128 = (remaining_collateral as u128)
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

            let post_ratio_bps = remaining_coll_value
                .checked_mul(10_000)
                .ok_or(error!(SssError::InvalidPrice))?
                / remaining_debt_usd_e6;

            // Must restore to >= liquidation threshold (so the CDP is no longer liquidatable)
            require!(
                post_ratio_bps >= liquidation_threshold_bps,
                SssError::PartialLiquidationInsufficientRepay
            );
        }

        (repay, coll_to_seize)
    } else {
        // Full liquidation: burn all effective debt (principal + fees), seize all collateral
        (effective_debt, deposited)
    };

    // SSS-085 Fix 5: Slippage protection
    if min_collateral_amount > 0 {
        require!(
            collateral_to_seize >= min_collateral_amount,
            SssError::SlippageExceeded
        );
    }

    // 5. Burn debt tokens from liquidator
    spl_burn_checked(
        CpiContext::new(
            ctx.accounts.sss_token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.liquidator_sss_account.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        ),
        debt_to_burn,
        ctx.accounts.sss_mint.decimals,
    )?;

    // 6. Transfer collateral vault → liquidator (collateral_vault PDA signs)
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

    // 7. Update state
    // SSS-113 HIGH-05: Deduct fees first from accrued_fees, remainder from debt_amount.
    let position = &mut ctx.accounts.cdp_position;
    if debt_to_burn >= accrued_fees {
        position.accrued_fees = 0;
        position.debt_amount = position.debt_amount.saturating_sub(debt_to_burn - accrued_fees);
    } else {
        position.accrued_fees = position.accrued_fees.saturating_sub(debt_to_burn);
    }

    let vault = &mut ctx.accounts.collateral_vault;
    vault.deposited_amount = vault.deposited_amount.saturating_sub(collateral_to_seize);

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(debt_to_burn).unwrap();

    // 8. Emit SSS-100 CollateralLiquidated event
    emit!(CollateralLiquidated {
        mint: ctx.accounts.sss_mint.key(),
        collateral_mint: collateral_mint_key,
        cdp_owner: owner_key,
        liquidator: ctx.accounts.liquidator.key(),
        debt_burned: debt_to_burn,
        collateral_seized: collateral_to_seize,
        ratio_before_bps: ratio_bps as u64,
        partial: is_partial,
        bonus_bps,
    });

    emit!(CdpLiquidated {
        sss_mint: ctx.accounts.sss_mint.key(),
        owner: ctx.accounts.cdp_owner.key(),
        liquidator: ctx.accounts.liquidator.key(),
        collateral_mint: ctx.accounts.collateral_mint.key(),
        debt_burned: debt_to_burn,
        collateral_seized: collateral_to_seize,
        ratio_bps: ratio_bps as u64,
    });

    msg!(
        "CDP liquidated: burned {} SSS debt, seized {} collateral. Ratio was {}bps (threshold {}bps). partial={} bonus={}bps",
        debt_to_burn,
        collateral_to_seize,
        ratio_bps,
        liquidation_threshold_bps,
        is_partial,
        bonus_bps,
    );
    Ok(())
}
