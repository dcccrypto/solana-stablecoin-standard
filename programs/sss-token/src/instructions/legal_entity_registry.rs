//! SSS-156: Issuer legal entity registry — on-chain regulatory traceability.
//!
//! Adds an optional on-chain registry for regulated stablecoin issuers.
//! Enabled by FLAG_LEGAL_REGISTRY (bit 24).
//!
//! Instructions:
//! - `register_legal_entity`  — authority-only; creates IssuerRegistry PDA and
//!                              sets FLAG_LEGAL_REGISTRY on the config.
//! - `attest_legal_entity`    — attestor (notary/lawyer) co-signs the record.
//! - `update_legal_entity`    — authority-only; updates hashes / jurisdiction
//!                              (resets attestation until re-attested).

use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::state::{IssuerRegistry, StablecoinConfig, FLAG_LEGAL_REGISTRY};

// ─── Events ──────────────────────────────────────────────────────────────────

/// Emitted when a legal entity record is first registered.
#[event]
pub struct LegalEntityRegistered {
    pub sss_mint: Pubkey,
    pub legal_entity_hash: [u8; 32],
    pub jurisdiction: [u8; 4],
    pub registration_number_hash: [u8; 32],
    pub attestor: Pubkey,
    pub expiry_slot: u64,
}

/// Emitted when the attestor co-signs the registry record.
#[event]
pub struct LegalEntityAttested {
    pub sss_mint: Pubkey,
    pub attestor: Pubkey,
    pub attested_slot: u64,
}

/// Emitted when the authority updates the registry (resets attestation).
#[event]
pub struct LegalEntityUpdated {
    pub sss_mint: Pubkey,
    pub legal_entity_hash: [u8; 32],
    pub jurisdiction: [u8; 4],
    pub registration_number_hash: [u8; 32],
    pub attestor: Pubkey,
    pub expiry_slot: u64,
}

// ─── register_legal_entity ───────────────────────────────────────────────────

/// Authority-only: create the IssuerRegistry PDA and enable FLAG_LEGAL_REGISTRY.
///
/// - `legal_entity_hash`         — SHA-256 of the legal entity document.
/// - `jurisdiction`              — ISO 3166-1 alpha-2 code, zero-padded to 4 bytes.
/// - `registration_number_hash`  — SHA-256 of the registration number string.
/// - `attestor`                  — Pubkey of the notary who will co-sign.
/// - `expiry_slot`               — 0 = no expiry; otherwise the slot after which
///                                 the record is considered stale.
#[derive(Accounts)]
pub struct RegisterLegalEntity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + IssuerRegistry::INIT_SPACE,
        seeds = [IssuerRegistry::SEED, config.key().as_ref()],
        bump,
    )]
    pub issuer_registry: Account<'info, IssuerRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn register_legal_entity(
    ctx: Context<RegisterLegalEntity>,
    legal_entity_hash: [u8; 32],
    jurisdiction: [u8; 4],
    registration_number_hash: [u8; 32],
    attestor: Pubkey,
    expiry_slot: u64,
) -> Result<()> {
    // Validate: jurisdiction must not be all-zeros (would be unset)
    require!(
        jurisdiction != [0u8; 4],
        SssError::InvalidLegalEntityJurisdiction
    );
    // Validate: hashes must not be all-zeros
    require!(
        legal_entity_hash != [0u8; 32],
        SssError::InvalidLegalEntityHash
    );
    require!(
        registration_number_hash != [0u8; 32],
        SssError::InvalidLegalEntityHash
    );
    // Validate: attestor must not be the zero key
    require!(
        attestor != Pubkey::default(),
        SssError::InvalidLegalEntityAttestor
    );
    // Validate: expiry_slot is either 0 or in the future
    if expiry_slot != 0 {
        let current_slot = Clock::get()?.slot;
        require!(
            expiry_slot > current_slot,
            SssError::LegalEntityExpired
        );
    }

    let registry = &mut ctx.accounts.issuer_registry;
    registry.config = ctx.accounts.config.key();
    registry.legal_entity_hash = legal_entity_hash;
    registry.jurisdiction = jurisdiction;
    registry.registration_number_hash = registration_number_hash;
    registry.attestor = attestor;
    registry.attested_slot = 0;
    registry.expiry_slot = expiry_slot;
    registry.attested = false;
    registry.bump = ctx.bumps.issuer_registry;

    // Enable FLAG_LEGAL_REGISTRY on config
    let config = &mut ctx.accounts.config;
    config.feature_flags |= FLAG_LEGAL_REGISTRY;

    emit!(LegalEntityRegistered {
        sss_mint: config.mint,
        legal_entity_hash,
        jurisdiction,
        registration_number_hash,
        attestor,
        expiry_slot,
    });

    Ok(())
}

// ─── attest_legal_entity ─────────────────────────────────────────────────────

/// Attestor-only: co-sign the IssuerRegistry record.
///
/// Only the `attestor` Pubkey stored in the registry may sign.
/// Sets `attested = true` and records `attested_slot`.
#[derive(Accounts)]
pub struct AttestLegalEntity<'info> {
    /// Must match registry.attestor
    pub attestor: Signer<'info>,

    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [IssuerRegistry::SEED, config.key().as_ref()],
        bump = issuer_registry.bump,
        has_one = config @ SssError::Unauthorized,
    )]
    pub issuer_registry: Account<'info, IssuerRegistry>,
}

pub fn attest_legal_entity(ctx: Context<AttestLegalEntity>) -> Result<()> {
    let registry = &mut ctx.accounts.issuer_registry;

    // Must be called by the designated attestor
    require!(
        ctx.accounts.attestor.key() == registry.attestor,
        SssError::Unauthorized
    );

    // Cannot attest an already-attested record without re-registering
    require!(!registry.attested, SssError::LegalEntityAlreadyAttested);

    // Check not expired
    if registry.expiry_slot != 0 {
        let current_slot = Clock::get()?.slot;
        require!(
            current_slot <= registry.expiry_slot,
            SssError::LegalEntityExpired
        );
    }

    let current_slot = Clock::get()?.slot;
    registry.attested = true;
    registry.attested_slot = current_slot;

    emit!(LegalEntityAttested {
        sss_mint: ctx.accounts.config.mint,
        attestor: registry.attestor,
        attested_slot: current_slot,
    });

    Ok(())
}

// ─── update_legal_entity ─────────────────────────────────────────────────────

/// Authority-only: update the legal entity record.
///
/// Resets `attested = false` so the attestor must re-sign.
/// Used when the issuer entity details change (e.g. re-registration).
#[derive(Accounts)]
pub struct UpdateLegalEntity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [IssuerRegistry::SEED, config.key().as_ref()],
        bump = issuer_registry.bump,
        has_one = config @ SssError::Unauthorized,
    )]
    pub issuer_registry: Account<'info, IssuerRegistry>,
}

pub fn update_legal_entity(
    ctx: Context<UpdateLegalEntity>,
    legal_entity_hash: [u8; 32],
    jurisdiction: [u8; 4],
    registration_number_hash: [u8; 32],
    attestor: Pubkey,
    expiry_slot: u64,
) -> Result<()> {
    // Same validations as register
    require!(
        jurisdiction != [0u8; 4],
        SssError::InvalidLegalEntityJurisdiction
    );
    require!(
        legal_entity_hash != [0u8; 32],
        SssError::InvalidLegalEntityHash
    );
    require!(
        registration_number_hash != [0u8; 32],
        SssError::InvalidLegalEntityHash
    );
    require!(
        attestor != Pubkey::default(),
        SssError::InvalidLegalEntityAttestor
    );
    if expiry_slot != 0 {
        let current_slot = Clock::get()?.slot;
        require!(
            expiry_slot > current_slot,
            SssError::LegalEntityExpired
        );
    }

    let registry = &mut ctx.accounts.issuer_registry;
    registry.legal_entity_hash = legal_entity_hash;
    registry.jurisdiction = jurisdiction;
    registry.registration_number_hash = registration_number_hash;
    registry.attestor = attestor;
    registry.expiry_slot = expiry_slot;
    // Reset attestation — new details require new attestor signature
    registry.attested = false;
    registry.attested_slot = 0;

    emit!(LegalEntityUpdated {
        sss_mint: ctx.accounts.config.mint,
        legal_entity_hash,
        jurisdiction,
        registration_number_hash,
        attestor,
        expiry_slot,
    });

    Ok(())
}
