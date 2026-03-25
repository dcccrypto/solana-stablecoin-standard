//! SSS-098 — CollateralConfig PDA (per-collateral parameters)
//!
//! Introduces per-collateral on-chain configuration so that each accepted
//! collateral type can have independent LTV, liquidation threshold, bonus, and
//! deposit cap.  Previously all CDP math used hard-coded global constants.
//!
//! # Instructions
//!
//! * `register_collateral`       — authority-only; creates the PDA.
//! * `update_collateral_config`  — authority-only; updates mutable params.
//!
//! # Integration
//!
//! `cdp_deposit_collateral` must pass the optional `collateral_config` account.
//! When present, the handler:
//!   1. Rejects if `whitelisted == false`.
//!   2. Rejects if `total_deposited + amount > max_deposit_cap` (when cap > 0).
//!   3. Increments `total_deposited`.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::SssError;
use crate::state::{CollateralConfig, StablecoinConfig};

// ---------------------------------------------------------------------------
// register_collateral
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterCollateralParams {
    pub whitelisted: bool,
    pub max_ltv_bps: u16,
    pub liquidation_threshold_bps: u16,
    pub liquidation_bonus_bps: u16,
    /// 0 = unlimited
    pub max_deposit_cap: u64,
}

#[derive(Accounts)]
pub struct RegisterCollateral<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// SSS stablecoin config — must be SSS-3 and signer must be authority.
    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS-3 stablecoin mint — identifies the config.
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// The collateral token mint to register.
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// CollateralConfig PDA — created here.
    /// Seeds: [b"collateral-config", sss_mint, collateral_mint]
    #[account(
        init,
        payer = authority,
        space = 8 + CollateralConfig::INIT_SPACE,
        seeds = [
            CollateralConfig::SEED,
            sss_mint.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump,
    )]
    pub collateral_config: Box<Account<'info, CollateralConfig>>,

    pub system_program: Program<'info, System>,
}

pub fn register_collateral_handler(
    ctx: Context<RegisterCollateral>,
    params: RegisterCollateralParams,
) -> Result<()> {
    // BUG-010: Registering a new collateral type is a high-privilege op.
    // When timelock is active, block the direct call.
    // Caller must use SET_FEATURE_FLAG timelock to pre-approve, or disable
    // timelock (admin_timelock_delay == 0) for initial configuration.
    if ctx.accounts.config.admin_timelock_delay > 0 {
        // Only allow if FLAG_SQUADS_AUTHORITY is set (squads provides its own timelock)
        require!(
            ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0,
            SssError::TimelockRequired
        );
    }

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    CollateralConfig::validate(
        params.max_ltv_bps,
        params.liquidation_threshold_bps,
        params.liquidation_bonus_bps,
    )?;

    let cc = &mut ctx.accounts.collateral_config;
    cc.sss_mint = ctx.accounts.sss_mint.key();
    cc.collateral_mint = ctx.accounts.collateral_mint.key();
    cc.whitelisted = params.whitelisted;
    cc.max_ltv_bps = params.max_ltv_bps;
    cc.liquidation_threshold_bps = params.liquidation_threshold_bps;
    cc.liquidation_bonus_bps = params.liquidation_bonus_bps;
    cc.max_deposit_cap = params.max_deposit_cap;
    cc.total_deposited = 0;
    cc.bump = ctx.bumps.collateral_config;

    msg!(
        "SSS-098: registered CollateralConfig for mint {} — ltv={} bps, threshold={} bps, bonus={} bps, cap={}",
        ctx.accounts.collateral_mint.key(),
        params.max_ltv_bps,
        params.liquidation_threshold_bps,
        params.liquidation_bonus_bps,
        params.max_deposit_cap,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// update_collateral_config
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateCollateralConfigParams {
    pub whitelisted: bool,
    pub max_ltv_bps: u16,
    pub liquidation_threshold_bps: u16,
    pub liquidation_bonus_bps: u16,
    /// 0 = unlimited
    pub max_deposit_cap: u64,
}

#[derive(Accounts)]
pub struct UpdateCollateralConfig<'info> {
    pub authority: Signer<'info>,

    /// SSS stablecoin config — authority check.
    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS-3 stablecoin mint.
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// The collateral token mint.
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// Existing CollateralConfig PDA to update.
    #[account(
        mut,
        seeds = [
            CollateralConfig::SEED,
            sss_mint.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump = collateral_config.bump,
        constraint = collateral_config.sss_mint == sss_mint.key(),
        constraint = collateral_config.collateral_mint == collateral_mint.key(),
    )]
    pub collateral_config: Box<Account<'info, CollateralConfig>>,
}

pub fn update_collateral_config_handler(
    ctx: Context<UpdateCollateralConfig>,
    params: UpdateCollateralConfigParams,
) -> Result<()> {
    // BUG-010: Updating collateral config (LTV/liquidation params) is high-risk.
    // Require Squads multisig OR zero timelock (initial setup).
    if ctx.accounts.config.admin_timelock_delay > 0 {
        require!(
            ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0,
            SssError::TimelockRequired
        );
    }

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    CollateralConfig::validate(
        params.max_ltv_bps,
        params.liquidation_threshold_bps,
        params.liquidation_bonus_bps,
    )?;

    let cc = &mut ctx.accounts.collateral_config;
    cc.whitelisted = params.whitelisted;
    cc.max_ltv_bps = params.max_ltv_bps;
    cc.liquidation_threshold_bps = params.liquidation_threshold_bps;
    cc.liquidation_bonus_bps = params.liquidation_bonus_bps;
    cc.max_deposit_cap = params.max_deposit_cap;

    msg!(
        "SSS-098: updated CollateralConfig for mint {} — whitelisted={}, ltv={} bps, threshold={} bps, cap={}",
        ctx.accounts.collateral_mint.key(),
        params.whitelisted,
        params.max_ltv_bps,
        params.liquidation_threshold_bps,
        params.max_deposit_cap,
    );
    Ok(())
}
