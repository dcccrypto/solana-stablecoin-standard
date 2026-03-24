use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::{ReserveAttestationSubmitted, ReserveRatioEvent, ReserveBreach};
use crate::state::{StablecoinConfig, ProofOfReserves};

// ---------------------------------------------------------------------------
// submit_reserve_attestation — store a signed reserve claim on-chain
// ---------------------------------------------------------------------------

/// Accounts for submitting a reserve attestation.
/// Callable by: authority, whitelisted custodian, or Pyth publisher stored in config.
#[derive(Accounts)]
pub struct SubmitReserveAttestation<'info> {
    /// The attestor (authority, custodian, or Pyth publisher).
    #[account(mut)]
    pub attestor: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = (
            config.authority == attestor.key() ||
            config.expected_pyth_feed == attestor.key() ||
            config.reserve_attestor_whitelist.iter().any(|k| *k == attestor.key())
        ) @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init_if_needed,
        payer = attestor,
        space = 8 + ProofOfReserves::INIT_SPACE,
        seeds = [ProofOfReserves::SEED, config.mint.as_ref()],
        bump,
    )]
    pub proof_of_reserves: Account<'info, ProofOfReserves>,

    pub system_program: Program<'info, System>,
}

/// Submit or refresh a reserve attestation.
///
/// Stores `reserve_amount`, a 32-byte `attestation_hash`, `attestor` pubkey,
/// and the current `slot` into the `ProofOfReserves` PDA.
/// Emits `ReserveAttestationSubmitted`.
pub fn submit_reserve_attestation_handler(
    ctx: Context<SubmitReserveAttestation>,
    reserve_amount: u64,
    attestation_hash: [u8; 32],
) -> Result<()> {
    require!(reserve_amount > 0, SssError::ZeroAmount);

    let clock = Clock::get()?;
    let por = &mut ctx.accounts.proof_of_reserves;
    let config = &ctx.accounts.config;

    // If first-time init, set bump
    if por.bump == 0 {
        por.bump = ctx.bumps.proof_of_reserves;
        por.sss_mint = config.mint;
    }

    let prev_reserve = por.reserve_amount;
    por.reserve_amount = reserve_amount;
    por.attestation_hash = attestation_hash;
    por.attestor = ctx.accounts.attestor.key();
    por.last_attestation_slot = clock.slot;

    emit!(ReserveAttestationSubmitted {
        mint: config.mint,
        attestor: ctx.accounts.attestor.key(),
        reserve_amount,
        attestation_hash,
        slot: clock.slot,
        prev_reserve_amount: prev_reserve,
    });

    msg!(
        "ProofOfReserves: attestation submitted. mint={} reserve={} slot={} attestor={}",
        config.mint,
        reserve_amount,
        clock.slot,
        ctx.accounts.attestor.key(),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// verify_reserve_ratio — compute ratio and emit event; emit ReserveBreach if low
// ---------------------------------------------------------------------------

/// Accounts for verifying the reserve ratio. Read-only; callable by anyone.
#[derive(Accounts)]
pub struct VerifyReserveRatio<'info> {
    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [ProofOfReserves::SEED, config.mint.as_ref()],
        bump = proof_of_reserves.bump,
        constraint = proof_of_reserves.sss_mint == config.mint @ SssError::InvalidVault,
    )]
    pub proof_of_reserves: Account<'info, ProofOfReserves>,
}

/// Compute the current reserve ratio and emit `ReserveRatioEvent`.
/// If the ratio drops below `config.min_reserve_ratio_bps`, emit `ReserveBreach`.
/// Callable by anyone — intended for keepers and monitoring services.
pub fn verify_reserve_ratio_handler(ctx: Context<VerifyReserveRatio>) -> Result<()> {
    let config = &ctx.accounts.config;
    let por = &mut ctx.accounts.proof_of_reserves;

    let net_supply = config.net_supply();
    let reserve_amount = por.reserve_amount;

    // Compute ratio in basis points (10_000 = 100%)
    let ratio_bps: u64 = if net_supply == 0 {
        10_000
    } else {
        (reserve_amount as u128)
            .saturating_mul(10_000)
            .saturating_div(net_supply as u128) as u64
    };

    por.last_verified_ratio_bps = ratio_bps;

    emit!(ReserveRatioEvent {
        mint: config.mint,
        reserve_amount,
        net_supply,
        ratio_bps,
        last_attestation_slot: por.last_attestation_slot,
        attestor: por.attestor,
    });

    // Check breach threshold
    let min_ratio = config.min_reserve_ratio_bps;
    if min_ratio > 0 && ratio_bps < min_ratio as u64 {
        emit!(ReserveBreach {
            mint: config.mint,
            reserve_amount,
            net_supply,
            ratio_bps,
            min_ratio_bps: min_ratio,
            slot: por.last_attestation_slot,
        });
        msg!(
            "ProofOfReserves: RESERVE BREACH — mint={} ratio={}bps min={}bps",
            config.mint,
            ratio_bps,
            min_ratio,
        );
    }

    msg!(
        "ProofOfReserves: verified. mint={} ratio={}bps reserve={} supply={}",
        config.mint,
        ratio_bps,
        reserve_amount,
        net_supply,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// get_reserve_status — public read; returns reserve state via msg!
// ---------------------------------------------------------------------------

/// Accounts for reading reserve status. Read-only.
#[derive(Accounts)]
pub struct GetReserveStatus<'info> {
    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ProofOfReserves::SEED, config.mint.as_ref()],
        bump = proof_of_reserves.bump,
        constraint = proof_of_reserves.sss_mint == config.mint @ SssError::InvalidVault,
    )]
    pub proof_of_reserves: Account<'info, ProofOfReserves>,
}

/// Read reserve status and emit a summary via `msg!`.
/// Returns: (reserve_amount, net_supply, ratio_bps, last_attestation_slot, attestor).
pub fn get_reserve_status_handler(ctx: Context<GetReserveStatus>) -> Result<()> {
    let config = &ctx.accounts.config;
    let por = &ctx.accounts.proof_of_reserves;
    let net_supply = config.net_supply();
    let ratio_bps: u64 = if net_supply == 0 {
        10_000
    } else {
        (por.reserve_amount as u128)
            .saturating_mul(10_000)
            .saturating_div(net_supply as u128) as u64
    };

    msg!(
        "ReserveStatus: mint={} reserve_amount={} net_supply={} ratio_bps={} last_slot={} attestor={}",
        config.mint,
        por.reserve_amount,
        net_supply,
        ratio_bps,
        por.last_attestation_slot,
        por.attestor,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// set_reserve_attestor_whitelist — authority-only whitelist management
// ---------------------------------------------------------------------------

/// Accounts for updating the reserve attestor whitelist.
#[derive(Accounts)]
pub struct SetReserveAttestorWhitelist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

/// Replace the reserve attestor whitelist on the config. Authority only.
/// Max 4 entries. Pass empty vec to clear.
pub fn set_reserve_attestor_whitelist_handler(
    ctx: Context<SetReserveAttestorWhitelist>,
    whitelist: Vec<Pubkey>,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        whitelist.len() <= StablecoinConfig::MAX_RESERVE_ATTESTORS,
        SssError::ReserveAttestorWhitelistFull
    );
    let config = &mut ctx.accounts.config;
    config.reserve_attestor_whitelist = [Pubkey::default(); StablecoinConfig::MAX_RESERVE_ATTESTORS];
    for (i, pk) in whitelist.iter().enumerate() {
        config.reserve_attestor_whitelist[i] = *pk;
    }
    msg!(
        "ProofOfReserves: attestor whitelist updated for mint {}. {} entries.",
        config.mint,
        whitelist.len()
    );
    Ok(())
}
