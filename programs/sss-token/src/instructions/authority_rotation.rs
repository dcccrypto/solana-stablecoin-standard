use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::{
    AuthorityRotationCancelled, AuthorityRotationCompleted, AuthorityRotationEmergencyRecovered,
    AuthorityRotationProposed,
};
use crate::state::{AuthorityRotationRequest, StablecoinConfig, FLAG_SQUADS_AUTHORITY};

/// 48 hours in slots at ~400ms/slot = 432,000 slots
pub const ROTATION_TIMELOCK_SLOTS: u64 = 432_000;
/// 7 days in slots
pub const EMERGENCY_RECOVERY_SLOTS: u64 = 7 * 432_000;

// ── propose_authority_rotation ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ProposeAuthorityRotation<'info> {
    /// Current authority (payer for the rotation_request PDA)
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// Rotation request PDA — must not already exist (init_if_needed errors if it does)
    #[account(
        init,
        payer = authority,
        space = 8 + AuthorityRotationRequest::SPACE,
        seeds = [AuthorityRotationRequest::SEED, mint.key().as_ref()],
        bump,
    )]
    pub rotation_request: Account<'info, AuthorityRotationRequest>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn propose_authority_rotation_handler(
    ctx: Context<ProposeAuthorityRotation>,
    new_authority: Pubkey,
    backup_authority: Pubkey,
) -> Result<()> {
    // SSS-134: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &ctx.accounts.config;
    let clock = Clock::get()?;

    require!(
        new_authority != config.authority,
        SssError::RotationNewAuthorityIsCurrent
    );
    require!(
        backup_authority != config.authority,
        SssError::RotationBackupIsCurrent
    );
    require!(
        backup_authority != new_authority,
        SssError::RotationBackupEqualsNew
    );
    require!(
        new_authority != Pubkey::default(),
        SssError::RotationZeroPubkey
    );
    require!(
        backup_authority != Pubkey::default(),
        SssError::RotationZeroPubkey
    );

    let req = &mut ctx.accounts.rotation_request;
    req.config_mint = config.mint;
    req.current_authority = config.authority;
    req.new_authority = new_authority;
    req.backup_authority = backup_authority;
    req.proposed_slot = clock.slot;
    req.timelock_slots = ROTATION_TIMELOCK_SLOTS;
    req.bump = ctx.bumps.rotation_request;

    emit!(AuthorityRotationProposed {
        mint: config.mint,
        current_authority: config.authority,
        new_authority,
        backup_authority,
        proposed_slot: clock.slot,
        timelock_slots: ROTATION_TIMELOCK_SLOTS,
    });

    msg!(
        "SSS-120: authority rotation proposed — new={} backup={} timelock_slots={} maturity_slot={}",
        new_authority,
        backup_authority,
        ROTATION_TIMELOCK_SLOTS,
        clock.slot + ROTATION_TIMELOCK_SLOTS,
    );
    Ok(())
}

// ── accept_authority_rotation ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AcceptAuthorityRotation<'info> {
    /// Must be rotation_request.new_authority
    pub new_authority: Signer<'info>,

    /// Receives the closed rotation_request rent lamports
    /// CHECK: verified to be rotation_request.current_authority below
    #[account(mut)]
    pub current_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        close = current_authority,
        seeds = [AuthorityRotationRequest::SEED, mint.key().as_ref()],
        bump = rotation_request.bump,
        constraint = rotation_request.config_mint == mint.key() @ SssError::Unauthorized,
        constraint = rotation_request.new_authority == new_authority.key() @ SssError::Unauthorized,
        constraint = rotation_request.current_authority == current_authority.key() @ SssError::Unauthorized,
    )]
    pub rotation_request: Account<'info, AuthorityRotationRequest>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn accept_authority_rotation_handler(ctx: Context<AcceptAuthorityRotation>) -> Result<()> {
    let clock = Clock::get()?;
    let req = &ctx.accounts.rotation_request;

    require!(
        clock.slot >= req.proposed_slot.checked_add(req.timelock_slots).ok_or(error!(SssError::Overflow))?,
        SssError::TimelockNotMature
    );

    let config = &mut ctx.accounts.config;
    let prev_authority = config.authority;
    config.authority = req.new_authority;
    config.pending_authority = Pubkey::default();

    emit!(AuthorityRotationCompleted {
        mint: config.mint,
        prev_authority,
        new_authority: req.new_authority,
    });

    msg!(
        "SSS-120: authority rotation accepted — authority={} (prev={})",
        req.new_authority,
        prev_authority,
    );
    Ok(())
}

// ── emergency_recover_authority ───────────────────────────────────────────────

#[derive(Accounts)]
pub struct EmergencyRecoverAuthority<'info> {
    /// Must be rotation_request.backup_authority
    pub backup_authority: Signer<'info>,

    /// Receives the closed rotation_request rent lamports
    /// CHECK: verified to be rotation_request.current_authority below
    #[account(mut)]
    pub current_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        close = current_authority,
        seeds = [AuthorityRotationRequest::SEED, mint.key().as_ref()],
        bump = rotation_request.bump,
        constraint = rotation_request.config_mint == mint.key() @ SssError::Unauthorized,
        constraint = rotation_request.backup_authority == backup_authority.key() @ SssError::Unauthorized,
        constraint = rotation_request.current_authority == current_authority.key() @ SssError::Unauthorized,
    )]
    pub rotation_request: Account<'info, AuthorityRotationRequest>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn emergency_recover_authority_handler(
    ctx: Context<EmergencyRecoverAuthority>,
) -> Result<()> {
    let clock = Clock::get()?;
    let req = &ctx.accounts.rotation_request;

    require!(
        clock.slot >= req.proposed_slot.checked_add(EMERGENCY_RECOVERY_SLOTS).ok_or(error!(SssError::Overflow))?,
        SssError::EmergencyRecoveryNotReady
    );

    let config = &mut ctx.accounts.config;
    let prev_authority = config.authority;
    config.authority = req.backup_authority;
    config.pending_authority = Pubkey::default();

    emit!(AuthorityRotationEmergencyRecovered {
        mint: config.mint,
        prev_authority,
        backup_authority: req.backup_authority,
    });

    msg!(
        "SSS-120: emergency authority recovery — authority={} (prev={})",
        req.backup_authority,
        prev_authority,
    );
    Ok(())
}

// ── cancel_authority_rotation ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CancelAuthorityRotation<'info> {
    /// Must be current config.authority (NOT the proposed new_authority)
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        close = authority,
        seeds = [AuthorityRotationRequest::SEED, mint.key().as_ref()],
        bump = rotation_request.bump,
        constraint = rotation_request.config_mint == mint.key() @ SssError::Unauthorized,
        constraint = rotation_request.current_authority == authority.key() @ SssError::Unauthorized,
    )]
    pub rotation_request: Account<'info, AuthorityRotationRequest>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn cancel_authority_rotation_handler(ctx: Context<CancelAuthorityRotation>) -> Result<()> {
    // SSS-134: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &ctx.accounts.config;
    let req = &ctx.accounts.rotation_request;

    emit!(AuthorityRotationCancelled {
        mint: config.mint,
        authority: config.authority,
        cancelled_new_authority: req.new_authority,
    });

    msg!(
        "SSS-120: authority rotation cancelled — cancelled proposed new_authority={}",
        req.new_authority,
    );
    Ok(())
}
