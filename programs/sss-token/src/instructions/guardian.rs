//! SSS-121 — Guardian Multisig Emergency Pause
//! BUG-018 — Guardian pause not overridable by authority instantly (timelock fix)
//!
//! Adds a `GuardianConfig` PDA that stores up to 7 guardian pubkeys and a
//! threshold (e.g. 3-of-5).  Guardians can collectively pause the mint without
//! authority involvement.
//!
//! **BUG-018 Fix**: A guardian-initiated pause CANNOT be lifted by the authority
//! alone until `GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY` seconds (24h) have
//! elapsed.  Before that window, only full guardian quorum can lift the pause.
//! This prevents a compromised authority key from bypassing guardian emergency
//! pauses in the same block.
//!
//! ### Instruction lifecycle
//! 1. Authority calls `init_guardian_config` once to register guardians + threshold.
//! 2. Any guardian calls `guardian_propose_pause` to open a new PauseProposal PDA.
//! 3. Remaining guardians call `guardian_vote_pause` — once `votes.len() >= threshold`,
//!    the proposal auto-executes and pauses the mint.
//!    On pause execution: `guardian_pause_active = true` and
//!    `guardian_pause_unlocks_at = now + GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY`.
//! 4. `guardian_lift_pause`:
//!    - Guardian quorum (all guardians): always allowed to lift.
//!    - Authority alone: only allowed if guardian_pause_active is false, OR if
//!      `now >= guardian_pause_unlocks_at` (timelock expired).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::{
    GuardianPauseAuthorityOverride, GuardianPauseLifted, GuardianPauseProposed,
    GuardianPauseVoted, MintPausedEvent,
};
use crate::state::{GuardianConfig, PauseProposal, StablecoinConfig, FLAG_SQUADS_AUTHORITY};

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
    // AUDIT NOTE: Squads enforcement — defense-in-depth verify_squads_signer check.
    // The has_one = authority constraint already guarantees config.authority == authority.key(),
    // and after init_squads_authority config.authority IS the Squads multisig PDA, so the
    // constraint provides equivalent security. This explicit check adds belt-and-suspenders.
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
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
    // BUG-018: initialise timelock fields
    gc.guardian_pause_active = false;
    gc.guardian_pause_unlocks_at = 0;

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
/// Creates a PauseProposal PDA and records the proposer's YES vote.
/// If threshold == 1, the pause is applied immediately.
pub fn guardian_propose_pause_handler(
    ctx: Context<GuardianProposePause>,
    reason: [u8; 32],
) -> Result<()> {
    let gc = &mut ctx.accounts.guardian_config;
    let proposer = ctx.accounts.guardian.key();

    require!(gc.guardians.contains(&proposer), SssError::NotAGuardian);

    let proposal_id = gc.next_proposal_id;
    gc.next_proposal_id = gc.next_proposal_id.checked_add(1)
        .ok_or(error!(SssError::Overflow))?;

    let proposal = &mut ctx.accounts.proposal;
    proposal.config = ctx.accounts.config.key();
    proposal.proposal_id = proposal_id;
    proposal.proposer = proposer;
    proposal.reason = reason;
    proposal.votes = vec![proposer];
    proposal.threshold = gc.threshold;
    proposal.executed = false;
    proposal.bump = ctx.bumps.proposal;

    emit!(GuardianPauseProposed {
        mint: ctx.accounts.mint.key(),
        proposer,
        proposal_id,
        reason,
    });

    msg!(
        "Guardian {} proposed pause (proposal_id={}) — 1/{} votes",
        proposer,
        proposal_id,
        gc.threshold,
    );

    // If threshold is 1, auto-execute immediately
    if gc.threshold == 1 {
        let cfg = &mut ctx.accounts.config;
        cfg.paused = true;
        proposal.executed = true;
        // BUG-018: mark guardian pause active + set timelock
        let now = Clock::get()?.unix_timestamp;
        gc.guardian_pause_active = true;
        gc.guardian_pause_unlocks_at =
            now.checked_add(GuardianConfig::GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY)
                .ok_or(error!(SssError::Overflow))?;
        gc.pending_lift_votes.clear();
        emit!(MintPausedEvent {
            mint: ctx.accounts.mint.key(),
            paused: true,
        });
        msg!("Threshold=1 — mint {} PAUSED immediately by guardian", ctx.accounts.mint.key());
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
        mut,
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
        constraint = !proposal.executed @ SssError::AlreadyVoted,
    )]
    pub proposal: Account<'info, PauseProposal>,
}

/// Cast a YES vote on an open pause proposal.
/// When votes.len() >= threshold the mint is paused immediately.
pub fn guardian_vote_pause_handler(
    ctx: Context<GuardianVotePause>,
    proposal_id: u64,
) -> Result<()> {
    let gc = &mut ctx.accounts.guardian_config;
    let voter = ctx.accounts.guardian.key();

    require!(gc.guardians.contains(&voter), SssError::NotAGuardian);
    let proposal = &mut ctx.accounts.proposal;
    require!(proposal.proposal_id == proposal_id, SssError::Unauthorized);
    require!(!proposal.votes.contains(&voter), SssError::AlreadyVoted);

    proposal.votes.push(voter);

    let votes_so_far = proposal.votes.len() as u8;
    emit!(GuardianPauseVoted {
        mint: ctx.accounts.mint.key(),
        guardian: voter,
        proposal_id,
        votes_so_far,
        threshold: gc.threshold,
    });

    msg!(
        "Guardian {} voted YES on proposal {} — {}/{} votes",
        voter,
        proposal_id,
        votes_so_far,
        gc.threshold,
    );

    if votes_so_far >= gc.threshold {
        let cfg = &mut ctx.accounts.config;
        cfg.paused = true;
        proposal.executed = true;
        // BUG-018: mark guardian pause active + set timelock
        let now = Clock::get()?.unix_timestamp;
        gc.guardian_pause_active = true;
        gc.guardian_pause_unlocks_at =
            now.checked_add(GuardianConfig::GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY)
                .ok_or(error!(SssError::Overflow))?;
        gc.pending_lift_votes.clear();
        emit!(MintPausedEvent {
            mint: ctx.accounts.mint.key(),
            paused: true,
        });
        msg!(
            "Quorum reached — mint {} PAUSED. Authority override locked until Unix {}",
            ctx.accounts.mint.key(),
            gc.guardian_pause_unlocks_at,
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
/// **BUG-018 Fix** — who can call:
/// - Full guardian quorum: always allowed to lift via `pending_lift_votes`.
/// - The stablecoin authority:
///   - If `guardian_pause_active == false` (pause was NOT guardian-initiated): can lift immediately.
///   - If `guardian_pause_active == true` AND timelock not expired: REJECTED.
///     Authority must wait `GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY` seconds (24h).
///   - If `guardian_pause_active == true` AND timelock expired: allowed (emits override event).
///
/// This prevents a compromised authority key from bypassing guardian emergency
/// pauses in the same block as the compromise.
pub fn guardian_lift_pause_handler(ctx: Context<GuardianLiftPause>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    let gc = &mut ctx.accounts.guardian_config;
    let caller = ctx.accounts.caller.key();

    let is_authority = cfg.authority == caller;
    let is_guardian = gc.guardians.contains(&caller);

    // Guardian path: accumulate lift votes; unpause on full quorum
    if is_guardian {
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
            gc.guardian_pause_active = false;
            gc.guardian_pause_unlocks_at = 0;
            gc.pending_lift_votes.clear();
            emit!(GuardianPauseLifted {
                mint: ctx.accounts.mint.key(),
                lifted_by: caller,
                by_quorum: true,
            });
            msg!(
                "Full guardian quorum — mint {} UNPAUSED",
                ctx.accounts.mint.key()
            );
        }
        return Ok(());
    }

    // Authority path
    require!(is_authority, SssError::Unauthorized);
    // AUDIT NOTE: Squads enforcement on authority lift-pause path.
    if cfg.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            cfg,
            &caller,
        )?;
    }

    if gc.guardian_pause_active {
        // BUG-018: check timelock before allowing authority override
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= gc.guardian_pause_unlocks_at,
            SssError::GuardianPauseTimelockActive
        );
        // Timelock expired — authority may override but must emit a distinct event
        cfg.paused = false;
        gc.guardian_pause_active = false;
        gc.guardian_pause_unlocks_at = 0;
        gc.pending_lift_votes.clear();
        emit!(GuardianPauseAuthorityOverride {
            mint: ctx.accounts.mint.key(),
            authority: caller,
            timestamp: now,
        });
        msg!(
            "Authority {} overrode expired guardian pause on mint {} at Unix {}",
            caller,
            ctx.accounts.mint.key(),
            now
        );
    } else {
        // No guardian pause active — authority may lift freely (e.g. authority-initiated pause)
        cfg.paused = false;
        gc.pending_lift_votes.clear();
        emit!(GuardianPauseLifted {
            mint: ctx.accounts.mint.key(),
            lifted_by: caller,
            by_quorum: false,
        });
        msg!(
            "Authority {} lifted pause on mint {}",
            caller,
            ctx.accounts.mint.key()
        );
    }

    Ok(())
}
