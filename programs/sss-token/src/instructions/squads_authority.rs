use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::{SquadsAuthorityInitialized, SquadsAuthorityVerified};
use crate::state::{StablecoinConfig, SquadsMultisigConfig, FLAG_SQUADS_AUTHORITY, PRESET_INSTITUTIONAL};

// ---------------------------------------------------------------------------
// SSS-134: Squads Protocol V4 multisig native authority integration
// ---------------------------------------------------------------------------
//
// PRESET_INSTITUTIONAL (4) = all SSS-3 features + Squads Protocol V4 multisig
// as the program authority.  Recommended for issuers holding > $1M reserves.
//
// Architecture:
//   - `init_squads_authority(multisig_pda, threshold, members)` — transfers
//     authority from the current bare keypair to the Squads multisig PDA in a
//     single atomic tx.  Sets FLAG_SQUADS_AUTHORITY (irreversible).
//   - `verify_squads_signer` helper — used by all authority-gated instructions
//     when FLAG_SQUADS_AUTHORITY is set to validate the signer is the Squads PDA.
//   - `SquadsMultisigConfig` PDA — stores threshold, member list, and nonce for
//     offline verification and SDK introspection.
//
// Squads V4 multisig PDAs are program-owned accounts; their pubkey acts as the
// signer in Anchor's `Signer` context when the Squads program CPI-calls into
// this program.  We store and validate only the PDA address — threshold/member
// enforcement is delegated to the Squads on-chain program.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitSquadsAuthorityParams {
    /// The Squads V4 multisig PDA that will become the new program authority.
    pub multisig_pda: Pubkey,
    /// Approval threshold (m of n). Stored for documentation; enforced by Squads.
    pub threshold: u8,
    /// Member pubkeys (up to MAX_MEMBERS).
    pub members: Vec<Pubkey>,
}

// ---------------------------------------------------------------------------
// InitSquadsAuthority — transfer authority to Squads multisig PDA
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(params: InitSquadsAuthorityParams)]
pub struct InitSquadsAuthority<'info> {
    /// Current authority (bare keypair) — must sign to authorize the transfer.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Stablecoin config — authority is transferred here.
    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.squads_multisig == Pubkey::default()
            @ SssError::SquadsAuthorityAlreadySet,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// SquadsMultisigConfig PDA — stores threshold and member list for SDK use.
    #[account(
        init,
        payer = authority,
        space = 8 + SquadsMultisigConfig::space(params.members.len()),
        seeds = [SquadsMultisigConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub squads_config: Account<'info, SquadsMultisigConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn init_squads_authority_handler(
    ctx: Context<InitSquadsAuthority>,
    params: InitSquadsAuthorityParams,
) -> Result<()> {
    require!(
        params.multisig_pda != Pubkey::default(),
        SssError::SquadsMultisigPdaInvalid
    );
    require!(
        params.threshold > 0,
        SssError::SquadsThresholdZero
    );
    require!(
        !params.members.is_empty(),
        SssError::SquadsMembersEmpty
    );
    require!(
        params.members.len() <= SquadsMultisigConfig::MAX_MEMBERS,
        SssError::SquadsMembersTooMany
    );
    require!(
        params.threshold as usize <= params.members.len(),
        SssError::SquadsThresholdExceedsMembers
    );

    // Check for duplicate members
    let mut seen = std::collections::BTreeSet::new();
    for m in &params.members {
        require!(seen.insert(m), SssError::SquadsDuplicateMember);
    }

    let config = &mut ctx.accounts.config;

    // Transfer authority to Squads multisig PDA
    let old_authority = config.authority;
    config.authority = params.multisig_pda;
    config.squads_multisig = params.multisig_pda;
    config.preset = PRESET_INSTITUTIONAL;
    // Set FLAG_SQUADS_AUTHORITY (irreversible — cannot be cleared via feature_flags)
    config.feature_flags |= FLAG_SQUADS_AUTHORITY;

    // Populate SquadsMultisigConfig PDA
    let sc = &mut ctx.accounts.squads_config;
    sc.sss_mint = ctx.accounts.mint.key();
    sc.multisig_pda = params.multisig_pda;
    sc.threshold = params.threshold;
    sc.members = params.members.clone();
    sc.bump = ctx.bumps.squads_config;

    emit!(SquadsAuthorityInitialized {
        mint: ctx.accounts.mint.key(),
        multisig_pda: params.multisig_pda,
        threshold: params.threshold,
        member_count: params.members.len() as u8,
        old_authority,
    });

    msg!(
        "SquadsAuthority INITIALIZED: multisig_pda={} threshold={}/{} preset=4",
        params.multisig_pda,
        params.threshold,
        params.members.len()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// VerifySquadsAuthority — read-only check instruction (admin tooling)
// ---------------------------------------------------------------------------
// Used by integrators to confirm that a given signer is the registered Squads
// multisig PDA for this stablecoin.  Emits SquadsAuthorityVerified event.
// Does NOT mutate state.

#[derive(Accounts)]
pub struct VerifySquadsAuthority<'info> {
    /// The Squads multisig PDA (must sign — Squads program calls this via CPI).
    pub squads_signer: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.feature_flags & FLAG_SQUADS_AUTHORITY != 0
            @ SssError::SquadsAuthorityNotSet,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn verify_squads_authority_handler(ctx: Context<VerifySquadsAuthority>) -> Result<()> {
    verify_squads_signer(
        &ctx.accounts.config,
        &ctx.accounts.squads_signer.key(),
    )?;

    emit!(SquadsAuthorityVerified {
        mint: ctx.accounts.mint.key(),
        multisig_pda: ctx.accounts.squads_signer.key(),
        verified: true,
    });

    msg!(
        "SquadsAuthority VERIFIED: signer={}",
        ctx.accounts.squads_signer.key()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// verify_squads_signer — helper used by authority-gated instructions
// ---------------------------------------------------------------------------
/// Call this at the top of any authority-gated instruction when FLAG_SQUADS_AUTHORITY
/// is set. Returns `SssError::SquadsSignerMismatch` if `signer` does not match the
/// registered Squads multisig PDA.
///
/// Typical usage in an instruction handler:
/// ```ignore
/// if config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
///     verify_squads_signer(&config, ctx.accounts.authority.key())?;
/// }
/// ```
pub fn verify_squads_signer(
    config: &StablecoinConfig,
    signer: &Pubkey,
) -> Result<()> {
    require!(
        config.feature_flags & FLAG_SQUADS_AUTHORITY != 0,
        SssError::SquadsAuthorityNotSet
    );
    require!(
        config.squads_multisig != Pubkey::default(),
        SssError::SquadsMultisigPdaInvalid
    );
    require!(
        *signer == config.squads_multisig,
        SssError::SquadsSignerMismatch
    );
    Ok(())
}
