use anchor_lang::prelude::*;

use crate::constants::*;
use crate::events::ReserveAttested;
use crate::state::{AttestReserveParams, ReserveAttestation, RoleEntry, StablecoinConfig};

pub fn attest_reserve(ctx: Context<AttestReserveCtx>, params: AttestReserveParams) -> Result<()> {
    let attestation = &mut ctx.accounts.attestation;
    attestation.config = ctx.accounts.config.key();
    attestation.attestor = ctx.accounts.attestor.key();
    attestation.reserve_amount = params.reserve_amount;
    attestation.source = params.source;
    attestation.uri = params.uri;
    attestation.timestamp = Clock::get()?.unix_timestamp;
    attestation.bump = ctx.bumps.attestation;
    attestation._reserved = [0u8; 32];

    emit_cpi!(ReserveAttested {
        config: ctx.accounts.config.key(),
        attestor: ctx.accounts.attestor.key(),
        reserve_amount: attestation.reserve_amount,
        source: attestation.source.clone(),
        uri: attestation.uri.clone(),
        timestamp: attestation.timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct AttestReserveCtx<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), attestor.key().as_ref(), &[ROLE_ATTESTOR]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    // SAFETY: init_if_needed is intentionally used to implement a "latest-only"
    // attestation model. The PDA is seeded by ["reserve", config] with no index,
    // so repeated calls overwrite the same account. This is by design — only the
    // most recent attestation is kept on-chain. Historical attestations are
    // preserved in transaction history and ReserveAttested events for audit.
    // A future version may add an index to the seed for on-chain history.
    #[account(
        init_if_needed,
        payer = attestor,
        space = 8 + ReserveAttestation::INIT_SPACE,
        seeds = [RESERVE_SEED, config.key().as_ref()],
        bump,
    )]
    pub attestation: Account<'info, ReserveAttestation>,

    pub system_program: Program<'info, System>,
}
