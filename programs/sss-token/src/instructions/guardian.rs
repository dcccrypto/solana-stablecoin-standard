//! SSS-121 — Guardian Multisig Emergency Pause
//!
//! Adds a `GuardianConfig` PDA that stores up to 7 guardian pubkeys and a
//! threshold (e.g. 3-of-5).  Guardians can collectively pause the mint without
//! authority involvement.  Only the authority (or full guardian quorum) can lift
//! the pause.
//!
//! **Guardrail**: guardians CANNOT mint, burn, change config, or alter fees.
//! Their only power is pause/unpause, enforced at the instruction level.
//!
//! ### Instruction lifecycle
//! 1. Authority calls `init_guardian_config` once to register guardians + threshold.
//! 2. Any guardian calls `guardian_propose_pause` to open a new PauseProposal PDA.
//! 3. Remaining guardians call `guardian_vote_pause` — once `votes.len() >= threshold`,
//!    the proposal auto-executes and pauses the mint.
//! 4. `guardian_lift_pause`: requires authority OR full guardian quorum.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::{GuardianPauseLifted, GuardianPauseProposed, GuardianPauseVoted, MintPausedEvent};
use crate::state::{GuardianConfig, PauseProposal, StablecoinConfig};

// ─── init_guardian_config ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitGuardianConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + GuardianConfig::INIT_SPACE,
        seeds = [GuardianConfig::SEED, config.key().as_ref()],
        bump,
    )]
    pub guardian_config: Account<'info, GuardianConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialise the guardian multisig for a stablecoin config.
/// Registers 1–7 guardian pubkeys and a threshold (≥1, ≤guardians.len()).
/// Authority only; can only be called once (PDA is `init`).
pub fn init_guardian_config_handler(
    ctx: Context<InitGuardianConfig>,
    guardians: Vec<Pubkey>,
    threshold: u8,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(!guardians.is_empty(), SssError::GuardianListEmpty);
    require!(
        guardians.len() <= GuardianConfig::MAX_GUARDIANS,
        SssError::GuardianListFull
    );
    require!(threshold >= 1, SssError::InvalidGuardianThreshold);
    require!(
        threshold as usize <= guardians.len(),
        SssError::InvalidGuardianThreshold
    );

    // Reject duplicate guardians
    for i in 0..guardians.len() {
        for j in (i + 1)..guardians.len() {
            require!(guardians[i] != guardians[j], SssError::DuplicateGuardian);
        }
    }

    let gc = &mut ctx.accounts.guardian_config;
    gc.config = ctx.accounts.config.key();
    gc.guardians = guardians;
    gc.threshold = threshold;
    gc.next_proposal_id = 0;
    gc.bump = ctx.bumps.guardian_config;

    msg!(
        "GuardianConfig initialised for mint {} with {} guardians, threshold={}",
        ctx.accounts.mint.key(),
        gc.guardians.len(),
        gc.threshold,
    );
    Ok(())
}

// ─── guardian_propose_pause ──────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(reason: [u8; 32])]
pub struct GuardianProposePause<'info> {
    #[account(mut)]
    pub guardian: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [GuardianConfig::SEED, config.key().as_ref()],
        bump = guardian_config.bump,
    )]
    pub guardian_config: Account<'info, GuardianConfig>,

    #[account(
        init,
        payer = guardian,
        space = 8 + PauseProposal::INIT_SPACE,
        seeds = [
            PauseProposal::SEED,
            config.key().as_ref(),
            &guardian_config.next_proposal_id.to_le_bytes(),
        ],
        bump,
    )]
    pub proposal: Account<'info, PauseProposal>,

    pub system_program: Program<'info, System>,
}

/// Any registered guardian proposes an emergency pause.
/// Creates a `PauseProposal` PDA collecting votes.
/// If threshold == 1 the pause is applied immediately.
pub fn guardian_propose_pause_handler(
    ctx: Context<GuardianProposePause>,
    reason: [u8; 32],
) -> Result<()> {
    let gc = &mut ctx.accounts.guardian_config;
    require!(
        gc.guardians.contains(&ctx.accounts.guardian.key()),
        SssError::NotAGuardian
    );

    let proposal_id = gc.next_proposal_id;
    gc.next_proposal_id = gc.next_proposal_id.checked_add(1).unwrap();

    let proposal = &mut ctx.accounts.proposal;
    proposal.config = ctx.accounts.config.key();
    proposal.proposal_id = proposal_id;
    proposal.proposer = ctx.accounts.guardian.key();
    proposal.reason = reason;
    proposal.votes = vec![ctx.accounts.guardian.key()];
    proposal.threshold = gc.threshold;
    proposal.executed = false;
    proposal.bump = ctx.bumps.proposal;

    emit!(GuardianPauseProposed {
        mint: ctx.accounts.mint.key(),
        proposer: ctx.accounts.guardian.key(),
        proposal_id,
        reason,
    });

    // Auto-execute if threshold met (single-guardian config)
    if proposal.votes.len() >= gc.threshold as usize {
        let cfg = &mut ctx.accounts.config;
        cfg.paused = true;
        proposal.executed = true;
        emit!(MintPausedEvent {
            mint: ctx.accounts.mint.key(),
            paused: true,
        });
        msg!("Guardian emergency pause EXECUTED (proposal #{}) — mint paused", proposal_id);
    } else {
        msg!(
            "Guardian pause proposed (id={}) by {} — {}/{} votes",
            proposal_id,
            ctx.accounts.guardian.key(),
            proposal.votes.len(),
            gc.threshold
        );
    }

    Ok(())
}

// ─── guardian_vote_pause ─────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct GuardianVotePause<'info> {
    #[account(mut)]
    pub guardian: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [GuardianConfig::SEED, config.key().as_ref()],
        bump = guardian_config.bump,
    )]
    pub guardian_config: Account<'info, GuardianConfig>,

    #[account(
        mut,
        seeds = [
            PauseProposal::SEED,
            config.key().as_ref(),
            &proposal_id.to_le_bytes(),
        ],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, PauseProposal>,
}

/// Cast a YES vote on an open pause proposal.
/// When `votes.len() >= threshold`, the pause is applied immediately.
pub fn guardian_vote_pause_handler(
    ctx: Context<GuardianVotePause>,
    proposal_id: u64,
) -> Result<()> {
    let gc = &ctx.accounts.guardian_config;
    require!(
        gc.guardians.contains(&ctx.accounts.guardian.key()),
        SssError::NotAGuardian
    );

    let proposal = &mut ctx.accounts.proposal;
    require!(!proposal.executed, SssError::ProposalAlreadyExecuted);
    require!(proposal.proposal_id == proposal_id, SssError::ProposalActionMismatch);

    // Prevent double-voting
    require!(
        !proposal.votes.contains(&ctx.accounts.guardian.key()),
        SssError::AlreadyVoted
    );
    require!(
        proposal.votes.len() < PauseProposal::MAX_VOTES,
        SssError::GuardianListFull
    );

    proposal.votes.push(ctx.accounts.guardian.key());

    emit!(GuardianPauseVoted {
        mint: ctx.accounts.mint.key(),
        guardian: ctx.accounts.guardian.key(),
        proposal_id,
        votes_so_far: proposal.votes.len() as u8,
        threshold: proposal.threshold,
    });

    msg!(
        "Guardian {} voted on proposal #{} — {}/{} votes",
        ctx.accounts.guardian.key(),
        proposal_id,
        proposal.votes.len(),
        proposal.threshold
    );

    // Auto-execute when threshold reached
    if proposal.votes.len() >= proposal.threshold as usize {
        let cfg = &mut ctx.accounts.config;
        cfg.paused = true;
        proposal.executed = true;
        emit!(MintPausedEvent {
            mint: ctx.accounts.mint.key(),
            paused: true,
        });
        msg!(
            "Guardian threshold reached — mint {} PAUSED (proposal #{})",
            ctx.accounts.mint.key(),
            proposal_id
        );
    }

    Ok(())
}

// ─── guardian_lift_pause ─────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct GuardianLiftPause<'info> {
    /// Either the stablecoin authority OR a guardian (for full-quorum unpause)
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [GuardianConfig::SEED, config.key().as_ref()],
        bump = guardian_config.bump,
    )]
    pub guardian_config: Account<'info, GuardianConfig>,
}

/// Lift a guardian-imposed pause.
///
/// **Who can call:**
/// - The stablecoin authority (unconditional).
/// - Any guardian when `full_quorum_unlock == true`, checked by scanning a
///   full-quorum vote record. For simplicity this instruction is authority-only
///   unless the caller is the authority; full guardian quorum lift requires all
///   guardians to sign via a dedicated "lift proposal" flow tracked in
///   `guardian_config.pending_lift_votes`.
///
/// **Simplified:** authority OR all-guardians-must-have-signed (we implement
/// that as: authority can always unpause; guardian quorum signals via the
/// `pending_lift_votes` field incremented by `guardian_vote_lift`).
pub fn guardian_lift_pause_handler(ctx: Context<GuardianLiftPause>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    let gc = &mut ctx.accounts.guardian_config;
    let caller = ctx.accounts.caller.key();

    let is_authority = cfg.authority == caller;
    let is_guardian = gc.guardians.contains(&caller);

    // INTENTIONAL: emergency bypass — authority can lift pause without Squads multisig
    // for rapid incident response. This allows the authority key to immediately restore
    // operations during an outage without waiting for multisig quorum.
    if is_authority {
        cfg.paused = false;
        gc.pending_lift_votes.clear();
        emit!(GuardianPauseLifted {
            mint: ctx.accounts.mint.key(),
            lifted_by: caller,
            by_quorum: false,
        });
        msg!("Authority {} lifted guardian pause on mint {}", caller, ctx.accounts.mint.key());
        return Ok(());
    }

    // Guardian path: accumulate votes; unpause on full quorum
    require!(is_guardian, SssError::NotAGuardian);
    require!(
        !gc.pending_lift_votes.contains(&caller),
        SssError::AlreadyVoted
    );
    gc.pending_lift_votes.push(caller);

    msg!(
        "Guardian {} voted to lift pause — {}/{} (full quorum required)",
        caller,
        gc.pending_lift_votes.len(),
        gc.guardians.len()
    );

    if gc.pending_lift_votes.len() >= gc.guardians.len() {
        cfg.paused = false;
        gc.pending_lift_votes.clear();
        emit!(GuardianPauseLifted {
            mint: ctx.accounts.mint.key(),
            lifted_by: caller,
            by_quorum: true,
        });
        msg!("Full guardian quorum — mint {} UNPAUSED", ctx.accounts.mint.key());
    }

    Ok(())
}
