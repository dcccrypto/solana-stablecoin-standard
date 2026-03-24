use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{StablecoinConfig, ZkComplianceConfig, VerificationRecord, FLAG_ZK_COMPLIANCE};

// ---------------------------------------------------------------------------
// init_zk_compliance — initialize ZkComplianceConfig PDA for a mint
// ---------------------------------------------------------------------------

/// Accounts for initializing ZK compliance support.
/// Authority only; one-time per stablecoin config; SSS-2 only.
/// Atomically enables FLAG_ZK_COMPLIANCE.
#[derive(Accounts)]
pub struct InitZkCompliance<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 2 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + ZkComplianceConfig::INIT_SPACE,
        seeds = [ZkComplianceConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub zk_compliance_config: Account<'info, ZkComplianceConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialize the ZkComplianceConfig PDA for a stablecoin mint.
///
/// Sets up ZK compliance enforcement with the specified `ttl_slots` (default 1500).
/// Optionally binds a `verifier_pubkey` (compliance oracle) that must co-sign
/// every `submit_zk_proof` call — prevents self-issued proofs.
/// Atomically enables FLAG_ZK_COMPLIANCE on the config.
/// Only valid for SSS-2 (compliant) stablecoins — requires a transfer hook.
pub fn init_zk_compliance_handler(
    ctx: Context<InitZkCompliance>,
    ttl_slots: u64,
    verifier_pubkey: Option<Pubkey>,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let effective_ttl = if ttl_slots == 0 {
        ZkComplianceConfig::DEFAULT_TTL_SLOTS
    } else {
        ttl_slots
    };

    let zk_config = &mut ctx.accounts.zk_compliance_config;
    zk_config.sss_mint = ctx.accounts.mint.key();
    zk_config.ttl_slots = effective_ttl;
    zk_config.verifier_pubkey = verifier_pubkey;
    zk_config.bump = ctx.bumps.zk_compliance_config;

    // Atomically enable the flag
    let config = &mut ctx.accounts.config;
    config.feature_flags |= FLAG_ZK_COMPLIANCE;

    msg!(
        "ZkCompliance: initialized for mint {}. ttl_slots={}. verifier={:?}. FLAG_ZK_COMPLIANCE enabled (flags=0x{:016x})",
        ctx.accounts.mint.key(),
        effective_ttl,
        verifier_pubkey,
        config.feature_flags,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// submit_zk_proof — create or refresh a VerificationRecord for the caller
// ---------------------------------------------------------------------------

/// Accounts for submitting a ZK proof.
/// Any user may call this to obtain or refresh their VerificationRecord.
/// If `ZkComplianceConfig.verifier_pubkey` is set, the `verifier` account
/// must be a Signer matching that pubkey (compliance oracle co-signature).
#[derive(Accounts)]
pub struct SubmitZkProof<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.feature_flags & FLAG_ZK_COMPLIANCE != 0 @ SssError::ZkComplianceNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [ZkComplianceConfig::SEED, mint.key().as_ref()],
        bump = zk_compliance_config.bump,
    )]
    pub zk_compliance_config: Account<'info, ZkComplianceConfig>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + VerificationRecord::INIT_SPACE,
        seeds = [VerificationRecord::SEED, mint.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub verification_record: Account<'info, VerificationRecord>,

    /// CHECK: Optional compliance oracle verifier. Required (and must sign) when
    /// `ZkComplianceConfig.verifier_pubkey` is Some(_). Ignored otherwise.
    pub verifier: Option<Signer<'info>>,

    pub system_program: Program<'info, System>,
}

/// Submit or refresh a ZK proof for the calling user.
///
/// Creates or updates the `VerificationRecord` PDA with an expiry of
/// `Clock::get().slot + zk_compliance_config.ttl_slots`.
///
/// When `ZkComplianceConfig.verifier_pubkey` is set, the `verifier` account
/// must be provided and must sign the transaction — this represents the
/// compliance oracle attesting that the user has passed off-chain verification.
/// When `verifier_pubkey` is `None`, any user may self-submit (open mode).
pub fn submit_zk_proof_handler(ctx: Context<SubmitZkProof>) -> Result<()> {
    // Enforce verifier co-signature if configured
    if let Some(required_vk) = ctx.accounts.zk_compliance_config.verifier_pubkey {
        match &ctx.accounts.verifier {
            Some(v) => {
                require!(
                    v.key() == required_vk,
                    SssError::ZkVerifierMismatch
                );
            }
            None => {
                return err!(SssError::ZkVerifierRequired);
            }
        }
    }

    let clock = Clock::get()?;
    let ttl = ctx.accounts.zk_compliance_config.ttl_slots;
    let expires_at = clock.slot.saturating_add(ttl);

    let record = &mut ctx.accounts.verification_record;
    record.sss_mint = ctx.accounts.mint.key();
    record.user = ctx.accounts.user.key();
    record.expires_at_slot = expires_at;
    record.bump = ctx.bumps.verification_record;

    msg!(
        "ZkCompliance: proof submitted for user {} on mint {}. expires_at_slot={} (current={}, ttl={}). verifier_required={}",
        ctx.accounts.user.key(),
        ctx.accounts.mint.key(),
        expires_at,
        clock.slot,
        ttl,
        ctx.accounts.zk_compliance_config.verifier_pubkey.is_some(),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// close_verification_record — authority closes an expired record (rent reclaim)
// ---------------------------------------------------------------------------

/// Accounts for closing an expired VerificationRecord.
/// Authority only. Record must be expired.
#[derive(Accounts)]
pub struct CloseVerificationRecord<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// The user whose record is being closed (rent returned to authority)
    /// CHECK: user pubkey validated via PDA seeds below
    pub record_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [VerificationRecord::SEED, mint.key().as_ref(), record_owner.key().as_ref()],
        bump = verification_record.bump,
        close = authority,
    )]
    pub verification_record: Account<'info, VerificationRecord>,
}

/// Close an expired VerificationRecord PDA, returning rent to authority.
///
/// Fails if the record has not yet expired (`Clock::slot < expires_at_slot`).
/// This prevents authority from forcibly invalidating live records.
pub fn close_verification_record_handler(ctx: Context<CloseVerificationRecord>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot >= ctx.accounts.verification_record.expires_at_slot,
        SssError::VerificationRecordNotExpired
    );

    msg!(
        "ZkCompliance: closed expired VerificationRecord for user {} on mint {}. expired_at={}, current={}",
        ctx.accounts.record_owner.key(),
        ctx.accounts.mint.key(),
        ctx.accounts.verification_record.expires_at_slot,
        clock.slot,
    );
    Ok(())
}
