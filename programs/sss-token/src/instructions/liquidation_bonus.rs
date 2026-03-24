use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::{LiquidationBonusConfigInitialised, LiquidationBonusConfigUpdated};
use crate::state::{LiquidationBonusConfig, StablecoinConfig, FLAG_GRAD_LIQUIDATION_BONUS};

// ---------------------------------------------------------------------------
// SSS-131: Graduated Liquidation Bonuses
// ---------------------------------------------------------------------------
//
// Replaces the flat `CollateralConfig.liquidation_bonus_bps` with a three-tier
// graduated bonus that increases as a CDP becomes more undercollateralised.
//
// Example configuration:
//   tier1: ratio 90–100%  (9000–10000 bps) → 5% bonus  (500 bps)
//   tier2: ratio 80–90%   (8000–9000 bps)  → 8% bonus  (800 bps)
//   tier3: ratio <80%     (<8000 bps)       → 12% bonus (1200 bps)
//
// The `LiquidationBonusConfig` PDA is seeded [b"liquidation-bonus-config", sss_mint].
// When FLAG_GRAD_LIQUIDATION_BONUS is set, `cdp_liquidate` reads this PDA to
// compute the applicable bonus instead of using the flat `CollateralConfig` value.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

fn validate_tiers(
    tier1_threshold_bps: u16,
    tier2_threshold_bps: u16,
    tier3_threshold_bps: u16,
    tier1_bonus_bps: u16,
    tier2_bonus_bps: u16,
    tier3_bonus_bps: u16,
    max_bonus_bps: u16,
) -> Result<()> {
    // Thresholds: tier3 < tier2 < tier1 (more distressed = lower threshold)
    require!(
        tier3_threshold_bps < tier2_threshold_bps,
        SssError::InvalidLiquidationTierConfig
    );
    require!(
        tier2_threshold_bps < tier1_threshold_bps,
        SssError::InvalidLiquidationTierConfig
    );
    // tier1 threshold must be ≤ 15000 (150%) — no need to reward anything above 150% CR
    require!(
        tier1_threshold_bps <= 15_000,
        SssError::InvalidLiquidationTierConfig
    );
    // Bonuses must be monotonically non-decreasing with depth
    require!(
        tier1_bonus_bps <= tier2_bonus_bps && tier2_bonus_bps <= tier3_bonus_bps,
        SssError::InvalidLiquidationTierConfig
    );
    // max_bonus_bps ≤ 5000 (50% max liquidation bonus)
    require!(max_bonus_bps <= 5_000, SssError::InvalidLiquidationTierConfig);
    // All bonuses must be within max_bonus_bps
    require!(
        tier1_bonus_bps <= max_bonus_bps
            && tier2_bonus_bps <= max_bonus_bps
            && tier3_bonus_bps <= max_bonus_bps,
        SssError::InvalidLiquidationTierConfig
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// init_liquidation_bonus_config — authority-only setup
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitLiquidationBonusConfigParams {
    pub tier1_threshold_bps: u16,
    pub tier1_bonus_bps: u16,
    pub tier2_threshold_bps: u16,
    pub tier2_bonus_bps: u16,
    pub tier3_threshold_bps: u16,
    pub tier3_bonus_bps: u16,
    pub max_bonus_bps: u16,
}

#[derive(Accounts)]
pub struct InitLiquidationBonusConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + LiquidationBonusConfig::INIT_SPACE,
        seeds = [LiquidationBonusConfig::SEED, config.mint.as_ref()],
        bump,
    )]
    pub liquidation_bonus_config: Account<'info, LiquidationBonusConfig>,

    pub system_program: Program<'info, System>,
}

pub fn init_liquidation_bonus_config_handler(
    ctx: Context<InitLiquidationBonusConfig>,
    params: InitLiquidationBonusConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    validate_tiers(
        params.tier1_threshold_bps,
        params.tier2_threshold_bps,
        params.tier3_threshold_bps,
        params.tier1_bonus_bps,
        params.tier2_bonus_bps,
        params.tier3_bonus_bps,
        params.max_bonus_bps,
    )?;

    let cfg = &mut ctx.accounts.liquidation_bonus_config;
    cfg.sss_mint = ctx.accounts.config.mint;
    cfg.authority = ctx.accounts.authority.key();
    cfg.tier1_threshold_bps = params.tier1_threshold_bps;
    cfg.tier1_bonus_bps = params.tier1_bonus_bps;
    cfg.tier2_threshold_bps = params.tier2_threshold_bps;
    cfg.tier2_bonus_bps = params.tier2_bonus_bps;
    cfg.tier3_threshold_bps = params.tier3_threshold_bps;
    cfg.tier3_bonus_bps = params.tier3_bonus_bps;
    cfg.max_bonus_bps = params.max_bonus_bps;
    cfg.bump = ctx.bumps.liquidation_bonus_config;

    // Enable the feature flag
    ctx.accounts.config.feature_flags |= FLAG_GRAD_LIQUIDATION_BONUS;

    emit!(LiquidationBonusConfigInitialised {
        mint: ctx.accounts.config.mint,
        tier1_threshold_bps: params.tier1_threshold_bps,
        tier1_bonus_bps: params.tier1_bonus_bps,
        tier2_threshold_bps: params.tier2_threshold_bps,
        tier2_bonus_bps: params.tier2_bonus_bps,
        tier3_threshold_bps: params.tier3_threshold_bps,
        tier3_bonus_bps: params.tier3_bonus_bps,
        max_bonus_bps: params.max_bonus_bps,
    });

    msg!(
        "SSS-131: Graduated liquidation bonus config initialised. \
        Tier1: <{}bps→{}bps, Tier2: <{}bps→{}bps, Tier3: <{}bps→{}bps, max={}bps",
        params.tier1_threshold_bps,
        params.tier1_bonus_bps,
        params.tier2_threshold_bps,
        params.tier2_bonus_bps,
        params.tier3_threshold_bps,
        params.tier3_bonus_bps,
        params.max_bonus_bps,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// update_liquidation_bonus_config — authority-only update
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateLiquidationBonusConfigParams {
    pub tier1_threshold_bps: u16,
    pub tier1_bonus_bps: u16,
    pub tier2_threshold_bps: u16,
    pub tier2_bonus_bps: u16,
    pub tier3_threshold_bps: u16,
    pub tier3_bonus_bps: u16,
    pub max_bonus_bps: u16,
}

#[derive(Accounts)]
pub struct UpdateLiquidationBonusConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [LiquidationBonusConfig::SEED, config.mint.as_ref()],
        bump = liquidation_bonus_config.bump,
        constraint = liquidation_bonus_config.sss_mint == config.mint @ SssError::Unauthorized,
    )]
    pub liquidation_bonus_config: Account<'info, LiquidationBonusConfig>,
}

pub fn update_liquidation_bonus_config_handler(
    ctx: Context<UpdateLiquidationBonusConfig>,
    params: UpdateLiquidationBonusConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    validate_tiers(
        params.tier1_threshold_bps,
        params.tier2_threshold_bps,
        params.tier3_threshold_bps,
        params.tier1_bonus_bps,
        params.tier2_bonus_bps,
        params.tier3_bonus_bps,
        params.max_bonus_bps,
    )?;

    let old = ctx.accounts.liquidation_bonus_config.clone();
    let cfg = &mut ctx.accounts.liquidation_bonus_config;
    cfg.tier1_threshold_bps = params.tier1_threshold_bps;
    cfg.tier1_bonus_bps = params.tier1_bonus_bps;
    cfg.tier2_threshold_bps = params.tier2_threshold_bps;
    cfg.tier2_bonus_bps = params.tier2_bonus_bps;
    cfg.tier3_threshold_bps = params.tier3_threshold_bps;
    cfg.tier3_bonus_bps = params.tier3_bonus_bps;
    cfg.max_bonus_bps = params.max_bonus_bps;

    emit!(LiquidationBonusConfigUpdated {
        mint: ctx.accounts.config.mint,
        old_tier1_threshold_bps: old.tier1_threshold_bps,
        old_tier1_bonus_bps: old.tier1_bonus_bps,
        new_tier1_threshold_bps: params.tier1_threshold_bps,
        new_tier1_bonus_bps: params.tier1_bonus_bps,
        old_tier2_threshold_bps: old.tier2_threshold_bps,
        old_tier2_bonus_bps: old.tier2_bonus_bps,
        new_tier2_threshold_bps: params.tier2_threshold_bps,
        new_tier2_bonus_bps: params.tier2_bonus_bps,
        old_tier3_threshold_bps: old.tier3_threshold_bps,
        old_tier3_bonus_bps: old.tier3_bonus_bps,
        new_tier3_threshold_bps: params.tier3_threshold_bps,
        new_tier3_bonus_bps: params.tier3_bonus_bps,
    });

    msg!(
        "SSS-131: Graduated liquidation bonus config updated. \
        Tier1: <{}bps→{}bps, Tier2: <{}bps→{}bps, Tier3: <{}bps→{}bps, max={}bps",
        params.tier1_threshold_bps,
        params.tier1_bonus_bps,
        params.tier2_threshold_bps,
        params.tier2_bonus_bps,
        params.tier3_threshold_bps,
        params.tier3_bonus_bps,
        params.max_bonus_bps,
    );
    Ok(())
}
