use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{StablecoinConfig, YieldCollateralConfig, FLAG_YIELD_COLLATERAL};

// ---------------------------------------------------------------------------
// init_yield_collateral — initialize the YieldCollateralConfig PDA for a mint
// ---------------------------------------------------------------------------

/// Accounts for initializing yield-bearing collateral support.
/// Authority only; one-time per stablecoin config.
/// Atomically enables FLAG_YIELD_COLLATERAL.
#[derive(Accounts)]
pub struct InitYieldCollateral<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + YieldCollateralConfig::INIT_SPACE,
        seeds = [YieldCollateralConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub yield_collateral_config: Account<'info, YieldCollateralConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialize the YieldCollateralConfig PDA for a stablecoin mint.
///
/// Sets up yield-bearing collateral support with an optional initial whitelist.
/// Atomically enables FLAG_YIELD_COLLATERAL on the config.
/// Only valid for SSS-3 (reserve-backed) stablecoins.
pub fn init_yield_collateral_handler(
    ctx: Context<InitYieldCollateral>,
    initial_mints: Vec<Pubkey>,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        initial_mints.len() <= YieldCollateralConfig::MAX_MINTS,
        SssError::WhitelistFull
    );

    let yc_config = &mut ctx.accounts.yield_collateral_config;
    yc_config.sss_mint = ctx.accounts.mint.key();
    yc_config.whitelisted_mints = initial_mints.clone();
    yc_config.bump = ctx.bumps.yield_collateral_config;

    // Atomically enable the flag
    let config = &mut ctx.accounts.config;
    config.feature_flags |= FLAG_YIELD_COLLATERAL;

    msg!(
        "YieldCollateral: initialized for mint {}. {} initial whitelist entries. FLAG_YIELD_COLLATERAL enabled (flags=0x{:016x})",
        ctx.accounts.mint.key(),
        initial_mints.len(),
        config.feature_flags,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// add_yield_collateral_mint — add a mint to the whitelist
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AddYieldCollateralMint<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [YieldCollateralConfig::SEED, mint.key().as_ref()],
        bump = yield_collateral_config.bump,
    )]
    pub yield_collateral_config: Account<'info, YieldCollateralConfig>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Add a yield-bearing SPL token mint to the whitelist.
/// Authority only. Max 8 mints. Rejects duplicates.
pub fn add_yield_collateral_mint_handler(
    ctx: Context<AddYieldCollateralMint>,
    collateral_mint: Pubkey,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let yc_config = &mut ctx.accounts.yield_collateral_config;

    require!(
        ctx.accounts.config.feature_flags & FLAG_YIELD_COLLATERAL != 0,
        SssError::YieldCollateralNotEnabled
    );

    require!(
        yc_config.whitelisted_mints.len() < YieldCollateralConfig::MAX_MINTS,
        SssError::WhitelistFull
    );

    require!(
        !yc_config.whitelisted_mints.contains(&collateral_mint),
        SssError::MintAlreadyWhitelisted
    );

    yc_config.whitelisted_mints.push(collateral_mint);

    msg!(
        "YieldCollateral: added mint {} to whitelist ({} total)",
        collateral_mint,
        yc_config.whitelisted_mints.len(),
    );
    Ok(())
}
