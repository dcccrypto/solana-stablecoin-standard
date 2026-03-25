/// SSS-BUG-008 / AUDIT-G6 / AUDIT-H4: Proof-of-Reserves management instructions
///
/// `init_proof_of_reserves` — authority creates the ProofOfReserves PDA for a mint.
/// `attest_proof_of_reserves` — designated attester updates the on-chain ratio.
use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::state::{ProofOfReserves, StablecoinConfig};

// ── init_proof_of_reserves ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitProofOfReserves<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Config authority — only the stablecoin authority can initialise PoR.
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        has_one = authority @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: validated via seeds on the ProofOfReserves account below.
    pub mint: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ProofOfReserves::INIT_SPACE,
        seeds = [ProofOfReserves::SEED, mint.key().as_ref()],
        bump,
    )]
    pub proof_of_reserves: Account<'info, ProofOfReserves>,

    pub system_program: Program<'info, System>,
}

pub fn init_proof_of_reserves_handler(
    ctx: Context<InitProofOfReserves>,
    attester: Pubkey,
) -> Result<()> {
    let por = &mut ctx.accounts.proof_of_reserves;
    por.mint = ctx.accounts.mint.key();
    por.last_attestation_slot = 0;
    por.last_verified_ratio_bps = 0;
    por.attester = attester;
    por.bump = ctx.bumps.proof_of_reserves;
    msg!(
        "ProofOfReserves initialised for mint {} — attester {}",
        por.mint,
        attester
    );
    Ok(())
}

// ── attest_proof_of_reserves ──────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AttestProofOfReserves<'info> {
    /// The authorised attester (oracle / keeper).
    pub attester: Signer<'info>,

    /// CHECK: validated via seeds on the ProofOfReserves account below.
    pub mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [ProofOfReserves::SEED, mint.key().as_ref()],
        bump = proof_of_reserves.bump,
        constraint = proof_of_reserves.attester == attester.key() @ SssError::Unauthorized,
    )]
    pub proof_of_reserves: Account<'info, ProofOfReserves>,
}

/// Submit a new attestation.
///
/// `verified_ratio_bps`: current reserve ratio in basis points (e.g. 10_000 = 100%).
pub fn attest_proof_of_reserves_handler(
    ctx: Context<AttestProofOfReserves>,
    verified_ratio_bps: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let por = &mut ctx.accounts.proof_of_reserves;
    por.last_attestation_slot = clock.slot;
    por.last_verified_ratio_bps = verified_ratio_bps;
    msg!(
        "PoR attested: mint={} ratio_bps={} slot={}",
        por.mint,
        verified_ratio_bps,
        clock.slot
    );
    Ok(())
}
