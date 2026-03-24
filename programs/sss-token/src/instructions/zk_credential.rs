use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::{
    CredentialIssued, CredentialRegistryInitialised, CredentialRegistryRootRotated,
    CredentialRevoked,
};
use crate::state::{
    CredentialRecord, CredentialRegistry, StablecoinConfig, FLAG_ZK_CREDENTIALS,
};

// ---------------------------------------------------------------------------
// SSS-129: ZK credential registry — Groth16-based selective disclosure
// ---------------------------------------------------------------------------
//
// Design:
//   1. Authority calls `init_credential_registry(issuer, merkle_root, ttl)` to
//      enable FLAG_ZK_CREDENTIALS and create a CredentialRegistry PDA.
//   2. A credential holder submits a Groth16 proof (encoded as a byte array) to
//      `verify_zk_credential`.  The program verifies the proof against the
//      registry Merkle root.  On success, a `CredentialRecord` PDA is created
//      (or refreshed) for the holder.
//   3. The transfer hook (when FLAG_ZK_CREDENTIALS is active) reads
//      `CredentialRecord` for the sender — if absent, expired, or revoked, the
//      transfer is rejected with `CredentialRequired`.
//   4. The issuer can rotate the Merkle root via `rotate_credential_root` and
//      revoke individual records via `revoke_credential`.
//   5. Holders can close their own records via `close_credential_record` to
//      reclaim rent once credentials are no longer needed.
//
// Groth16 note:
//   Full on-chain pairing is expensive (~200k CU with syscall optimisations).
//   This implementation uses a *stub* that checks proof.len() == 192 (standard
//   Groth16 proof length) and that the first 32 bytes of the public signal
//   matches the registry Merkle root — suitable for devnet/testnet and as a
//   placeholder until the Solana syscall `verify_groth16_bn254` is stabilised.
//   Replace `verify_groth16_stub` with the syscall when available.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Stub Groth16 verifier.  Returns Ok if proof looks structurally valid and
/// the embedded public input (first 32 bytes of `public_signals`) matches
/// `expected_root`.  Panics/errors on malformed input.
fn verify_groth16_stub(
    proof: &[u8],
    public_signals: &[u8],
    expected_root: &[u8; 32],
) -> Result<()> {
    // A Groth16 proof is 3 G1/G2 points = 3 * 64 bytes = 192 bytes.
    require!(proof.len() == 192, SssError::InvalidZkProof);
    // public_signals must be at least 32 bytes (the Merkle root commitment).
    require!(public_signals.len() >= 32, SssError::InvalidZkProof);

    let root_in_signal: &[u8; 32] = public_signals[..32]
        .try_into()
        .map_err(|_| error!(SssError::InvalidZkProof))?;

    require!(root_in_signal == expected_root, SssError::InvalidZkProof);

    Ok(())
}

// ---------------------------------------------------------------------------
// init_credential_registry
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitCredentialRegistryParams {
    /// Authority that may rotate the Merkle root and revoke credentials.
    pub issuer: Pubkey,
    /// Initial Groth16 Merkle root (32 bytes).
    pub merkle_root: [u8; 32],
    /// How many slots a CredentialRecord stays valid (0 = never expires).
    pub credential_ttl_slots: u64,
}

#[derive(Accounts)]
pub struct InitCredentialRegistry<'info> {
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
        space = 8 + CredentialRegistry::INIT_SPACE,
        seeds = [CredentialRegistry::SEED, config.mint.as_ref()],
        bump,
    )]
    pub registry: Account<'info, CredentialRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn init_credential_registry_handler(
    ctx: Context<InitCredentialRegistry>,
    params: InitCredentialRegistryParams,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let registry = &mut ctx.accounts.registry;

    registry.sss_mint = config.mint;
    registry.issuer = params.issuer;
    registry.merkle_root = params.merkle_root;
    registry.credential_ttl_slots = params.credential_ttl_slots;
    registry.updated_slot = Clock::get()?.slot;
    registry.bump = ctx.bumps.registry;

    // Enable the feature flag.
    config.feature_flags |= FLAG_ZK_CREDENTIALS;

    emit!(CredentialRegistryInitialised {
        mint: config.mint,
        issuer: params.issuer,
        merkle_root: params.merkle_root,
        credential_ttl_slots: params.credential_ttl_slots,
    });

    msg!(
        "CredentialRegistry initialised: mint={} issuer={} ttl={}",
        config.mint,
        params.issuer,
        params.credential_ttl_slots,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// rotate_credential_root — issuer rotates the Merkle root
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RotateCredentialRoot<'info> {
    pub issuer: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [CredentialRegistry::SEED, config.mint.as_ref()],
        bump = registry.bump,
        constraint = registry.issuer == issuer.key() @ SssError::Unauthorized,
    )]
    pub registry: Account<'info, CredentialRegistry>,
}

pub fn rotate_credential_root_handler(
    ctx: Context<RotateCredentialRoot>,
    new_merkle_root: [u8; 32],
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let slot = Clock::get()?.slot;

    registry.merkle_root = new_merkle_root;
    registry.updated_slot = slot;

    emit!(CredentialRegistryRootRotated {
        mint: registry.sss_mint,
        new_merkle_root,
        slot,
    });

    msg!(
        "CredentialRegistry root rotated: mint={} slot={}",
        registry.sss_mint,
        slot,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// verify_zk_credential — holder submits proof, receives CredentialRecord
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct VerifyZkCredential<'info> {
    /// The credential holder (pays rent for their CredentialRecord PDA).
    #[account(mut)]
    pub holder: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [CredentialRegistry::SEED, config.mint.as_ref()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, CredentialRegistry>,

    #[account(
        init_if_needed,
        payer = holder,
        space = 8 + CredentialRecord::INIT_SPACE,
        seeds = [CredentialRecord::SEED, config.mint.as_ref(), holder.key().as_ref()],
        bump,
    )]
    pub credential_record: Account<'info, CredentialRecord>,

    pub system_program: Program<'info, System>,
}

pub fn verify_zk_credential_handler(
    ctx: Context<VerifyZkCredential>,
    proof: Vec<u8>,
    public_signals: Vec<u8>,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let registry = &ctx.accounts.registry;

    // FLAG_ZK_CREDENTIALS must be active.
    require!(
        config.check_feature_flag(FLAG_ZK_CREDENTIALS),
        SssError::CredentialRegistryNotFound,
    );

    // Verify the Groth16 proof against the registry Merkle root.
    verify_groth16_stub(&proof, &public_signals, &registry.merkle_root)?;

    let slot = Clock::get()?.slot;
    let expires_slot = if registry.credential_ttl_slots == 0 {
        0
    } else {
        slot + registry.credential_ttl_slots
    };

    let record = &mut ctx.accounts.credential_record;
    record.sss_mint = config.mint;
    record.holder = ctx.accounts.holder.key();
    record.issued_slot = slot;
    record.expires_slot = expires_slot;
    record.revoked = false;
    record.bump = ctx.bumps.credential_record;

    emit!(CredentialIssued {
        mint: config.mint,
        holder: ctx.accounts.holder.key(),
        issued_slot: slot,
        expires_slot,
    });

    msg!(
        "CredentialRecord issued: mint={} holder={} expires_slot={}",
        config.mint,
        ctx.accounts.holder.key(),
        expires_slot,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// revoke_credential — issuer revokes a holder's credential
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RevokeCredential<'info> {
    pub issuer: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [CredentialRegistry::SEED, config.mint.as_ref()],
        bump = registry.bump,
        constraint = registry.issuer == issuer.key() @ SssError::Unauthorized,
    )]
    pub registry: Account<'info, CredentialRegistry>,

    #[account(
        mut,
        seeds = [CredentialRecord::SEED, config.mint.as_ref(), holder.key().as_ref()],
        bump = credential_record.bump,
    )]
    pub credential_record: Account<'info, CredentialRecord>,

    /// CHECK: read-only pubkey used as PDA seed
    pub holder: UncheckedAccount<'info>,
}

pub fn revoke_credential_handler(ctx: Context<RevokeCredential>) -> Result<()> {
    let record = &mut ctx.accounts.credential_record;
    record.revoked = true;

    let slot = Clock::get()?.slot;
    emit!(CredentialRevoked {
        mint: record.sss_mint,
        holder: record.holder,
        slot,
    });

    msg!(
        "Credential revoked: mint={} holder={} slot={}",
        record.sss_mint,
        record.holder,
        slot,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// close_credential_record — holder closes their own record to reclaim rent
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CloseCredentialRecord<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        close = holder,
        seeds = [CredentialRecord::SEED, config.mint.as_ref(), holder.key().as_ref()],
        bump = credential_record.bump,
        constraint = credential_record.holder == holder.key() @ SssError::Unauthorized,
    )]
    pub credential_record: Account<'info, CredentialRecord>,
}

pub fn close_credential_record_handler(ctx: Context<CloseCredentialRecord>) -> Result<()> {
    msg!(
        "CredentialRecord closed by holder: mint={} holder={}",
        ctx.accounts.config.mint,
        ctx.accounts.holder.key(),
    );
    Ok(())
}
