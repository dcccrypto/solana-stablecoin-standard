use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::ReserveCompositionUpdated;
use crate::state::{ReserveComposition, StablecoinConfig};

// ---------------------------------------------------------------------------
// update_reserve_composition — authority-only: create/update composition PDA
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct ReserveCompositionParams {
    /// Cash and cash equivalents in basis points (0–10000).
    pub cash_bps: u16,
    /// US Treasury Bills in basis points (0–10000).
    pub t_bills_bps: u16,
    /// Crypto assets in basis points (0–10000).
    pub crypto_bps: u16,
    /// Other assets in basis points (0–10000).
    pub other_bps: u16,
}

/// Accounts for updating (or initialising) the reserve composition.
#[derive(Accounts)]
pub struct UpdateReserveComposition<'info> {
    /// The stablecoin authority (only they may update composition).
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + ReserveComposition::INIT_SPACE,
        seeds = [ReserveComposition::SEED, config.mint.as_ref()],
        bump,
    )]
    pub reserve_composition: Account<'info, ReserveComposition>,

    pub system_program: Program<'info, System>,
}

/// Create or update the reserve composition breakdown.
///
/// `params.cash_bps + params.t_bills_bps + params.crypto_bps + params.other_bps` must equal 10_000.
/// Emits `ReserveCompositionUpdated`.
pub fn update_reserve_composition_handler(
    ctx: Context<UpdateReserveComposition>,
    params: ReserveCompositionParams,
) -> Result<()> {
    // AUDIT NOTE: No timelock enforcement — reserve composition updates
    // are not currently supported by the admin timelock operation set.
    // TODO: Add ADMIN_OP_UPDATE_RESERVE_COMPOSITION to admin_timelock.rs

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    // Validate sum == 10_000
    let sum = (params.cash_bps as u32)
        .saturating_add(params.t_bills_bps as u32)
        .saturating_add(params.crypto_bps as u32)
        .saturating_add(params.other_bps as u32);
    require!(sum == 10_000, SssError::InvalidCompositionBps);

    let clock = Clock::get()?;
    let rc = &mut ctx.accounts.reserve_composition;
    let config = &ctx.accounts.config;

    // Initialise on first use
    if rc.bump == 0 {
        rc.bump = ctx.bumps.reserve_composition;
        rc.sss_mint = config.mint;
    }

    rc.cash_bps = params.cash_bps;
    rc.t_bills_bps = params.t_bills_bps;
    rc.crypto_bps = params.crypto_bps;
    rc.other_bps = params.other_bps;
    rc.last_updated_slot = clock.slot;
    rc.last_updated_by = ctx.accounts.authority.key();

    emit!(ReserveCompositionUpdated {
        mint: config.mint,
        updated_by: ctx.accounts.authority.key(),
        cash_bps: params.cash_bps,
        t_bills_bps: params.t_bills_bps,
        crypto_bps: params.crypto_bps,
        other_bps: params.other_bps,
        slot: clock.slot,
    });

    msg!(
        "ReserveComposition: updated. mint={} cash={}bps t_bills={}bps crypto={}bps other={}bps slot={}",
        config.mint,
        params.cash_bps,
        params.t_bills_bps,
        params.crypto_bps,
        params.other_bps,
        clock.slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// get_reserve_composition — public read; logs current composition via msg!
// ---------------------------------------------------------------------------

/// Accounts for reading the reserve composition. Read-only; callable by anyone.
#[derive(Accounts)]
pub struct GetReserveComposition<'info> {
    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ReserveComposition::SEED, config.mint.as_ref()],
        bump = reserve_composition.bump,
        constraint = reserve_composition.sss_mint == config.mint @ SssError::InvalidVault,
    )]
    pub reserve_composition: Account<'info, ReserveComposition>,
}

/// Read and log the current reserve composition.
pub fn get_reserve_composition_handler(ctx: Context<GetReserveComposition>) -> Result<()> {
    let rc = &ctx.accounts.reserve_composition;
    msg!(
        "ReserveComposition: mint={} cash={}bps t_bills={}bps crypto={}bps other={}bps last_slot={} last_by={}",
        rc.sss_mint,
        rc.cash_bps,
        rc.t_bills_bps,
        rc.crypto_bps,
        rc.other_bps,
        rc.last_updated_slot,
        rc.last_updated_by,
    );
    Ok(())
}
