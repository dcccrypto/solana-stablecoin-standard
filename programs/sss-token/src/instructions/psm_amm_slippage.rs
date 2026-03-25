use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn_checked as spl_burn_checked, transfer_checked, BurnChecked, Mint, TokenAccount,
    TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::{PsmCurveConfigInitialised, PsmCurveConfigUpdated, PsmDynamicSwapEvent, PsmQuoteEvent};
use crate::state::{PsmCurveConfig, StablecoinConfig, FLAG_PSM_DYNAMIC_FEES};

// ---------------------------------------------------------------------------
// SSS-132: PSM Dynamic AMM-Style Slippage Curves
// ---------------------------------------------------------------------------
//
// Replaces flat `redemption_fee_bps` with a depth-based AMM fee curve:
//
//   fee_bps = base_fee_bps + curve_k * (imbalance / total_reserves)^2
//
// where imbalance = |vault_amount - ideal_balance|, ideal_balance = total_reserves / 2.
//
// At perfect 50/50 balance: fee = base_fee_bps (minimum).
// As pool becomes one-sided: fee increases quadratically up to max_fee_bps.
//
// Entrypoints:
//   init_psm_curve_config  — authority-only; creates PDA + enables flag
//   update_psm_curve_config — authority-only; update curve params
//   psm_dynamic_swap        — replaces `redeem` when FLAG_PSM_DYNAMIC_FEES set
//   get_psm_quote           — read-only; emits PsmQuoteEvent (no state change)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

fn validate_curve_params(base_fee_bps: u16, max_fee_bps: u16) -> Result<()> {
    require!(
        max_fee_bps <= PsmCurveConfig::MAX_FEE_BPS,
        SssError::InvalidPsmCurveMaxFee
    );
    require!(
        base_fee_bps <= max_fee_bps,
        SssError::InvalidPsmCurveBaseFee
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// init_psm_curve_config — create PDA and enable FLAG_PSM_DYNAMIC_FEES
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitPsmCurveConfigParams {
    /// Base fee when pool is at perfect balance (bps, e.g. 5 = 0.05%).
    pub base_fee_bps: u16,
    /// Curve steepness amplifier k.  Scaled by 1_000_000 internally.
    /// Example: 10_000_000_000 → at 100% imbalance, delta ≈ 10_000 bps → clamped.
    /// Practical values: 50_000_000 (adds 50 bps at full imbalance) to 500_000_000.
    pub curve_k: u64,
    /// Maximum fee cap (bps, ≤ 2000 = 20%).
    pub max_fee_bps: u16,
}

#[derive(Accounts)]
pub struct InitPsmCurveConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + PsmCurveConfig::INIT_SPACE,
        seeds = [PsmCurveConfig::SEED, config.mint.as_ref()],
        bump,
    )]
    pub psm_curve_config: Account<'info, PsmCurveConfig>,

    pub system_program: Program<'info, System>,
}

pub fn init_psm_curve_config_handler(
    ctx: Context<InitPsmCurveConfig>,
    params: InitPsmCurveConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    validate_curve_params(params.base_fee_bps, params.max_fee_bps)?;

    let cfg = &mut ctx.accounts.psm_curve_config;
    cfg.sss_mint = ctx.accounts.config.mint;
    cfg.authority = ctx.accounts.authority.key();
    cfg.base_fee_bps = params.base_fee_bps;
    cfg.curve_k = params.curve_k;
    cfg.max_fee_bps = params.max_fee_bps;
    cfg.bump = ctx.bumps.psm_curve_config;

    // Enable the feature flag
    ctx.accounts.config.feature_flags |= FLAG_PSM_DYNAMIC_FEES;

    emit!(PsmCurveConfigInitialised {
        mint: ctx.accounts.config.mint,
        base_fee_bps: params.base_fee_bps,
        curve_k: params.curve_k,
        max_fee_bps: params.max_fee_bps,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "SSS-132: PSM curve config initialised. base={}bps k={} max={}bps",
        params.base_fee_bps,
        params.curve_k,
        params.max_fee_bps,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// update_psm_curve_config — authority-only update
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdatePsmCurveConfigParams {
    pub base_fee_bps: u16,
    pub curve_k: u64,
    pub max_fee_bps: u16,
}

#[derive(Accounts)]
pub struct UpdatePsmCurveConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [PsmCurveConfig::SEED, config.mint.as_ref()],
        bump = psm_curve_config.bump,
        constraint = psm_curve_config.sss_mint == config.mint @ SssError::PsmCurveConfigNotFound,
    )]
    pub psm_curve_config: Account<'info, PsmCurveConfig>,
}

pub fn update_psm_curve_config_handler(
    ctx: Context<UpdatePsmCurveConfig>,
    params: UpdatePsmCurveConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    validate_curve_params(params.base_fee_bps, params.max_fee_bps)?;

    let cfg = &mut ctx.accounts.psm_curve_config;
    let old_base = cfg.base_fee_bps;
    let old_k = cfg.curve_k;
    let old_max = cfg.max_fee_bps;

    cfg.base_fee_bps = params.base_fee_bps;
    cfg.curve_k = params.curve_k;
    cfg.max_fee_bps = params.max_fee_bps;

    emit!(PsmCurveConfigUpdated {
        mint: ctx.accounts.config.mint,
        old_base_fee_bps: old_base,
        new_base_fee_bps: params.base_fee_bps,
        old_curve_k: old_k,
        new_curve_k: params.curve_k,
        old_max_fee_bps: old_max,
        new_max_fee_bps: params.max_fee_bps,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "SSS-132: PSM curve config updated. base={}bps k={} max={}bps",
        params.base_fee_bps,
        params.curve_k,
        params.max_fee_bps,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// psm_dynamic_swap — PSM redeem with dynamic AMM-style fee
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct PsmDynamicSwap<'info> {
    pub redeemer: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
        constraint = config.check_feature_flag(FLAG_PSM_DYNAMIC_FEES) @ SssError::PsmDynamicFeesNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        seeds = [PsmCurveConfig::SEED, sss_mint.key().as_ref()],
        bump = psm_curve_config.bump,
        constraint = psm_curve_config.sss_mint == config.mint @ SssError::PsmCurveConfigNotFound,
    )]
    pub psm_curve_config: Box<Account<'info, PsmCurveConfig>>,

    /// The SSS stablecoin mint
    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Redeemer's SSS token account (burned from)
    #[account(
        mut,
        constraint = redeemer_sss_account.owner == redeemer.key(),
        constraint = redeemer_sss_account.mint == sss_mint.key(),
    )]
    pub redeemer_sss_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Collateral mint (e.g. USDC)
    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint,
    )]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Reserve vault — releases collateral to redeemer (config PDA signs)
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

    /// Token program for SSS stablecoin (Token-2022)
    pub sss_token_program: Interface<'info, TokenInterface>,

    /// Token program for collateral mint (Token or Token-2022)
    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn psm_dynamic_swap_handler(ctx: Context<PsmDynamicSwap>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    let vault_amount_before = ctx.accounts.reserve_vault.amount;
    let total_reserves = ctx.accounts.config.total_collateral;

    require!(
        vault_amount_before >= amount,
        SssError::InsufficientReserves
    );

    // 1. Compute dynamic fee from curve
    let fee_bps = ctx.accounts.psm_curve_config.compute_fee(vault_amount_before, total_reserves);
    let fee_amount = if fee_bps > 0 {
        (amount as u128)
            .saturating_mul(fee_bps as u128)
            .checked_div(10_000)
            .unwrap_or(0) as u64
    } else {
        0
    };
    let collateral_out = amount.checked_sub(fee_amount).unwrap_or(0);
    require!(collateral_out > 0, SssError::PsmSwapOutputZero);

    // 2. Burn SSS tokens from redeemer
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

    // 3. Transfer (amount - fee) collateral from vault → redeemer
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

    // 4. Update config state
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(amount).unwrap();
    config.total_collateral = config.total_collateral.checked_sub(collateral_out)
        .ok_or(error!(SssError::InsufficientReserves))?;

    emit!(PsmDynamicSwapEvent {
        mint: config.mint,
        redeemer: ctx.accounts.redeemer.key(),
        sss_burned: amount,
        collateral_out,
        fee_collected: fee_amount,
        fee_bps,
        vault_amount_before,
        total_reserves,
    });

    msg!(
        "SSS-132: Dynamic PSM swap — burned={} out={} fee={} fee_bps={} vault_before={}",
        amount,
        collateral_out,
        fee_amount,
        fee_bps,
        vault_amount_before,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// get_psm_quote — read-only fee preview (no state mutation)
// ---------------------------------------------------------------------------
//
// Emits a PsmQuoteEvent so frontends can use program simulation (simulateTransaction)
// to fetch expected fees without executing a real swap.
// This is a zero-mutation instruction: no accounts are mutated.

#[derive(Accounts)]
pub struct GetPsmQuote<'info> {
    /// Anyone can call this — no signer required beyond the caller.
    /// CHECK: Read-only accounts; no mutation occurs.
    pub caller: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.check_feature_flag(FLAG_PSM_DYNAMIC_FEES) @ SssError::PsmDynamicFeesNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        seeds = [PsmCurveConfig::SEED, sss_mint.key().as_ref()],
        bump = psm_curve_config.bump,
        constraint = psm_curve_config.sss_mint == config.mint @ SssError::PsmCurveConfigNotFound,
    )]
    pub psm_curve_config: Box<Account<'info, PsmCurveConfig>>,

    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Reserve vault — read only for balance snapshot.
    #[account(
        constraint = reserve_vault.key() == config.reserve_vault @ SssError::InvalidVault,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn get_psm_quote_handler(ctx: Context<GetPsmQuote>, amount_in: u64) -> Result<()> {
    require!(amount_in > 0, SssError::ZeroAmount);

    let vault_amount = ctx.accounts.reserve_vault.amount;
    let total_reserves = ctx.accounts.config.total_collateral;

    let fee_bps = ctx.accounts.psm_curve_config.compute_fee(vault_amount, total_reserves);
    let expected_fee = (amount_in as u128)
        .saturating_mul(fee_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    let expected_out = amount_in.saturating_sub(expected_fee);

    emit!(PsmQuoteEvent {
        mint: ctx.accounts.config.mint,
        amount_in,
        expected_out,
        expected_fee,
        fee_bps,
        vault_amount,
    });

    msg!(
        "SSS-132: PSM quote — in={} out={} fee={} fee_bps={} vault={}",
        amount_in,
        expected_out,
        expected_fee,
        fee_bps,
        vault_amount,
    );
    Ok(())
}
