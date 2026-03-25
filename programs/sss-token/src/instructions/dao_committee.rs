//! SSS-067 — DAO Committee Governance
//!
//! Implements FLAG_DAO_COMMITTEE (bit 2, `1 << 2`).
//!
//! When the flag is set, the following admin operations are gated behind
//! on-chain proposals that must collect a configurable quorum of YES votes
//! from registered committee members before they can be executed:
//!   - pause / unpause
//!   - set_feature_flag / clear_feature_flag
//!   - update_minter / revoke_minter
//!
//! ### Lifecycle
//! 1. Authority calls `init_dao_committee` (one-time) to register members & quorum.
//! 2. Authority (or any member?) calls `propose_action` to open a proposal.
//! 3. Each committee member calls `vote_action` (YES only for simplicity; abstain = don't call).
//! 4. Once `votes.len() >= quorum`, anyone calls `execute_action` to carry out the op.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{
    DaoCommitteeConfig, FLAG_DAO_COMMITTEE, ProposalAction, ProposalPda, StablecoinConfig,
};

// ---------------------------------------------------------------------------
// init_dao_committee
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitDaoCommittee<'info> {
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
        space = 8 + DaoCommitteeConfig::INIT_SPACE,
        seeds = [DaoCommitteeConfig::SEED, config.key().as_ref()],
        bump,
    )]
    pub committee: Account<'info, DaoCommitteeConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialise the DAO committee for a stablecoin config.
/// Sets the member list and quorum threshold, and enables FLAG_DAO_COMMITTEE.
///
/// `members` — list of committee member pubkeys (1–10 entries).
/// `quorum`  — number of YES votes required to execute any proposal (≥ 1, ≤ members.len()).
pub fn init_dao_committee_handler(
    ctx: Context<InitDaoCommittee>,
    members: Vec<Pubkey>,
    quorum: u8,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(!members.is_empty(), SssError::InvalidQuorum);
    require!(
        members.len() <= DaoCommitteeConfig::MAX_MEMBERS,
        SssError::CommitteeFull
    );
    require!(
        quorum >= 1 && quorum as usize <= members.len(),
        SssError::InvalidQuorum
    );

    // SSS-085 Fix 3: Reject duplicate pubkeys to prevent quorum bypass with repeated keys.
    for i in 0..members.len() {
        for j in (i + 1)..members.len() {
            require!(members[i] != members[j], SssError::DuplicateMember);
        }
    }

    let committee = &mut ctx.accounts.committee;
    committee.config = ctx.accounts.config.key();
    committee.members = members.clone();
    committee.quorum = quorum;
    committee.next_proposal_id = 0;
    committee.bump = ctx.bumps.committee;

    // Enable the flag
    let config = &mut ctx.accounts.config;
    config.feature_flags |= FLAG_DAO_COMMITTEE;

    msg!(
        "DaoCommittee INIT — {} members, quorum={}, flags=0x{:016x}",
        members.len(),
        quorum,
        config.feature_flags
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// propose_action
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(action: ProposalAction, param: u64, target: Pubkey)]
pub struct ProposeAction<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [DaoCommitteeConfig::SEED, config.key().as_ref()],
        bump = committee.bump,
    )]
    pub committee: Account<'info, DaoCommitteeConfig>,

    #[account(
        init,
        payer = proposer,
        space = 8 + ProposalPda::INIT_SPACE,
        seeds = [ProposalPda::SEED, config.key().as_ref(), &committee.next_proposal_id.to_le_bytes()],
        bump,
    )]
    pub proposal: Account<'info, ProposalPda>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Open a new governance proposal.
///
/// Any committee member OR the current authority may propose. This ensures
/// the DAO committee is not authority-captured (BUG-011 fix).
pub fn propose_action_handler(
    ctx: Context<ProposeAction>,
    action: ProposalAction,
    param: u64,
    target: Pubkey,
) -> Result<()> {
    // DAO committee must be active
    require!(
        ctx.accounts.config.feature_flags & FLAG_DAO_COMMITTEE != 0,
        SssError::DaoCommitteeRequired
    );

    // BUG-011: allow any committee member OR authority to propose
    let proposer_key = ctx.accounts.proposer.key();
    let is_authority = ctx.accounts.config.authority == proposer_key;
    let is_member = ctx
        .accounts
        .committee
        .members
        .iter()
        .any(|m| *m == proposer_key);
    require!(
        is_authority || is_member,
        SssError::NotAuthorizedToPropose
    );

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.proposer.key(),
        )?;
    }

    let committee = &mut ctx.accounts.committee;
    let proposal_id = committee.next_proposal_id;
    committee.next_proposal_id = proposal_id.checked_add(1).unwrap();

    let proposal = &mut ctx.accounts.proposal;
    proposal.config = ctx.accounts.config.key();
    proposal.proposal_id = proposal_id;
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.action = action;
    proposal.param = param;
    proposal.target = target;
    proposal.votes = Vec::new();
    proposal.quorum = committee.quorum;
    proposal.executed = false;
    proposal.cancelled = false;
    proposal.bump = ctx.bumps.proposal;

    msg!(
        "Proposal #{} CREATED — action={:?} param={} target={}",
        proposal_id,
        action,
        param,
        target
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// vote_action
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct VoteAction<'info> {
    pub voter: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [DaoCommitteeConfig::SEED, config.key().as_ref()],
        bump = committee.bump,
    )]
    pub committee: Account<'info, DaoCommitteeConfig>,

    #[account(
        mut,
        seeds = [ProposalPda::SEED, config.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, ProposalPda>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Cast a YES vote on a proposal.
///
/// Caller must be in `committee.members`.
/// Duplicate votes (same voter, same proposal) are rejected.
/// Proposals that are already executed or cancelled cannot be voted on.
pub fn vote_action_handler(ctx: Context<VoteAction>, _proposal_id: u64) -> Result<()> {
    let voter_key = ctx.accounts.voter.key();

    // Must be a committee member
    require!(
        ctx.accounts.committee.members.contains(&voter_key),
        SssError::NotACommitteeMember
    );

    let proposal = &mut ctx.accounts.proposal;

    require!(!proposal.executed, SssError::ProposalAlreadyExecuted);
    require!(!proposal.cancelled, SssError::ProposalCancelled);
    require!(
        !proposal.votes.contains(&voter_key),
        SssError::AlreadyVoted
    );

    proposal.votes.push(voter_key);

    msg!(
        "Proposal #{} — vote by {} ({}/{} votes)",
        proposal.proposal_id,
        voter_key,
        proposal.votes.len(),
        proposal.quorum
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// execute_action
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ExecuteAction<'info> {
    /// Anyone can call execute once quorum is reached.
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [DaoCommitteeConfig::SEED, config.key().as_ref()],
        bump = committee.bump,
    )]
    pub committee: Account<'info, DaoCommitteeConfig>,

    #[account(
        mut,
        seeds = [ProposalPda::SEED, config.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, ProposalPda>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Execute a passed proposal.
///
/// Verifies quorum, marks the proposal executed, then applies the action
/// directly to `StablecoinConfig`.  Instruction is idempotency-safe: once
/// `executed = true` the proposal can never be re-run.
pub fn execute_action_handler(ctx: Context<ExecuteAction>, _proposal_id: u64) -> Result<()> {
    let proposal = &ctx.accounts.proposal;

    require!(!proposal.executed, SssError::ProposalAlreadyExecuted);
    require!(!proposal.cancelled, SssError::ProposalCancelled);
    require!(
        proposal.votes.len() >= proposal.quorum as usize,
        SssError::QuorumNotReached
    );

    let action = proposal.action;
    let param = proposal.param;

    // Mark executed before applying state changes (re-entrancy safety)
    let proposal = &mut ctx.accounts.proposal;
    proposal.executed = true;

    let config = &mut ctx.accounts.config;

    match action {
        ProposalAction::Pause => {
            config.paused = true;
            msg!("Proposal #{} EXECUTED — Pause", proposal.proposal_id);
        }
        ProposalAction::Unpause => {
            config.paused = false;
            msg!("Proposal #{} EXECUTED — Unpause", proposal.proposal_id);
        }
        ProposalAction::SetFeatureFlag => {
            config.feature_flags |= param;
            msg!(
                "Proposal #{} EXECUTED — SetFeatureFlag 0x{:016x} flags=0x{:016x}",
                proposal.proposal_id,
                param,
                config.feature_flags
            );
        }
        ProposalAction::ClearFeatureFlag => {
            config.feature_flags &= !param;
            msg!(
                "Proposal #{} EXECUTED — ClearFeatureFlag 0x{:016x} flags=0x{:016x}",
                proposal.proposal_id,
                param,
                config.feature_flags
            );
        }
        ProposalAction::UpdateMinter | ProposalAction::RevokeMinter => {
            // Minter management requires additional accounts (MinterInfo PDA).
            // For these actions the instruction is intentionally a no-op at the
            // config level — execution is confirmed via the executed flag, and
            // a separate privileged path in update_minter / revoke_minter checks
            // for an executed ProposalPda when FLAG_DAO_COMMITTEE is set.
            msg!(
                "Proposal #{} EXECUTED — {:?} target={} (minter ops execute via dedicated instruction)",
                proposal.proposal_id,
                action,
                proposal.target
            );
        }
    }

    Ok(())
}
