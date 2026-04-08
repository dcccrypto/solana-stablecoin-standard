//! SSS-110 — Agent Payment Channel (APC)
//!
//! Implements trustless payment channels between two agents: an initiator
//! (task poster) and a counterparty (service provider).  Funds are escrowed
//! at channel open and released on mutual settlement, dispute, or timeout.
//!
//! # Instructions
//! - `open_channel`        — initiator deposits tokens, channel goes Open
//! - `submit_work_proof`   — counterparty records proof of work on-chain
//! - `settle`              — two-step mutual settlement (propose + countersign)
//! - `dispute`             — move channel to Disputed state with evidence
//! - `force_close`         — initiator reclaims deposit after timeout
//!
//! # PaymentChannel PDA
//! Seeds: [b"apc-channel", initiator, channel_id.to_le_bytes()]
//!
//! # ProposedSettlement PDA
//! Seeds: [b"apc-settle", channel_pda_key]
//! Ephemeral — created on first settle call, consumed on countersign.
//!
//! # Feature flag
//! FLAG_AGENT_PAYMENT_CHANNEL (1 << 7) must be set on StablecoinConfig.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::{
    ChannelDisputed, ChannelForceClosed, ChannelOpened, ChannelSettled, DisputeResolved,
    WorkProofSubmitted,
};
use crate::state::{StablecoinConfig, FLAG_AGENT_PAYMENT_CHANNEL};

// ─── Channel status ───────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ChannelStatus {
    Open = 0,
    Disputed = 1,
    Settled = 2,
    ForceClose = 3,
}

impl ChannelStatus {
    /// True when the channel is in a terminal state (no further mutations allowed).
    pub fn is_terminal(&self) -> bool {
        matches!(self, ChannelStatus::Settled | ChannelStatus::ForceClose)
    }
}

// ─── PaymentChannel account ───────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct PaymentChannel {
    /// Party that opened and funded the channel.
    pub initiator: Pubkey,
    /// Service provider / recipient of successful work.
    pub counterparty: Pubkey,
    /// SSS stablecoin mint.
    pub stable_mint: Pubkey,
    /// Tokens deposited by the initiator.
    pub initiator_deposit: u64,
    /// Slot at which the channel was opened (used for timeout calculation).
    pub open_slot: u64,
    /// Monotonic channel id (caller-provided, unique per initiator).
    pub channel_id: u64,
    /// Dispute resolution policy: 0=OracleAttestation, 1=PeerQuorum, 2=TimeoutFallback.
    ///
    /// BUG-AUDIT3-004 (MEDIUM, documented): `dispute_policy` is stored on-chain
    /// as an advisory field only — the on-chain program does **not** enforce it.
    /// The `dispute` instruction moves the channel to Disputed state regardless of
    /// the policy value, and no on-chain arbitrator, oracle, or quorum is invoked.
    /// Actual dispute resolution is expected to be handled off-chain by the parties
    /// (or an integrated arbitration layer).  Protocol integrators MUST NOT assume
    /// that the on-chain program enforces oracle attestation or peer quorum; those
    /// mechanisms must be implemented at the application / SDK layer.
    pub dispute_policy: u8,
    /// Slots after open_slot before force_close is permitted.
    pub timeout_slots: u64,
    /// Latest work proof hash (SHA-256 of task+output hashes), or evidence hash in Disputed.
    pub work_proof_hash: [u8; 32],
    /// Current channel lifecycle status.
    pub status: ChannelStatus,
    /// PDA bump seed.
    pub bump: u8,
}

impl PaymentChannel {
    pub const SEED: &'static [u8] = b"apc-channel";
}

// ─── ProposedSettlement account ───────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct ProposedSettlement {
    /// Amount to release to the counterparty.
    pub amount: u64,
    /// Which party proposed the settlement (must be initiator or counterparty).
    pub proposed_by: Pubkey,
    /// PDA bump.
    pub bump: u8,
}

impl ProposedSettlement {
    pub const SEED: &'static [u8] = b"apc-settle";
}

// ─── Helper: channel PDA signer seeds ────────────────────────────────────────

fn channel_signer_seeds<'a>(
    initiator_key: &'a [u8],
    channel_id_bytes: &'a [u8],
    bump: &'a [u8],
) -> [&'a [u8]; 4] {
    [PaymentChannel::SEED, initiator_key, channel_id_bytes, bump]
}

// ─── open_channel ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OpenChannelParams {
    pub counterparty: Pubkey,
    pub deposit: u64,
    pub channel_id: u64,
    pub dispute_policy: u8,
    pub timeout_slots: u64,
}

#[derive(Accounts)]
#[instruction(params: OpenChannelParams)]
pub struct OpenChannel<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, stable_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset >= 1 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
        constraint = config.feature_flags & FLAG_AGENT_PAYMENT_CHANNEL != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(constraint = stable_mint.key() == config.mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = initiator,
        space = 8 + PaymentChannel::INIT_SPACE,
        seeds = [
            PaymentChannel::SEED,
            initiator.key().as_ref(),
            &params.channel_id.to_le_bytes(),
        ],
        bump,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,

    /// Escrow token account — owned by the channel PDA, pre-created by client.
    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == channel.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Initiator's token account (source of deposit).
    #[account(
        mut,
        constraint = initiator_token_account.mint == stable_mint.key(),
        constraint = initiator_token_account.owner == initiator.key(),
    )]
    pub initiator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[inline(never)]
pub fn open_channel_handler(
    ctx: Context<OpenChannel>,
    params: OpenChannelParams,
) -> Result<()> {
    require!(params.timeout_slots > 0, SssError::InvalidExpirySlot);
    // BUG-AUDIT3-003: require a non-zero deposit to prevent 0-cost channel
    // griefing (an attacker could spam open_channel with deposit=0, creating
    // thousands of zero-value PDAs that consume storage and block counterparty
    // key lookups without locking any funds).
    require!(params.deposit > 0, SssError::ZeroAmount);

    // Transfer deposit initiator → escrow.
    if params.deposit > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.initiator_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.initiator.to_account_info(),
                },
            ),
            params.deposit,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let clock = Clock::get()?;
    let channel = &mut ctx.accounts.channel;
    channel.initiator = ctx.accounts.initiator.key();
    channel.counterparty = params.counterparty;
    channel.stable_mint = ctx.accounts.stable_mint.key();
    channel.initiator_deposit = params.deposit;
    channel.open_slot = clock.slot;
    channel.channel_id = params.channel_id;
    channel.dispute_policy = params.dispute_policy;
    channel.timeout_slots = params.timeout_slots;
    channel.work_proof_hash = [0u8; 32];
    channel.status = ChannelStatus::Open;
    channel.bump = ctx.bumps.channel;

    emit!(ChannelOpened {
        channel_id: params.channel_id,
        initiator: ctx.accounts.initiator.key(),
        counterparty: params.counterparty,
        stable_mint: ctx.accounts.stable_mint.key(),
        initiator_deposit: params.deposit,
        dispute_policy: params.dispute_policy,
        timeout_slots: params.timeout_slots,
    });

    msg!(
        "APC: channel {} opened, deposit={}, timeout_slots={}",
        params.channel_id, params.deposit, params.timeout_slots,
    );
    Ok(())
}

// ─── submit_work_proof ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SubmitWorkProof<'info> {
    /// Either party can submit work proofs.
    pub submitter: Signer<'info>,

    #[account(
        mut,
        constraint = channel.status == ChannelStatus::Open @ SssError::ChannelAlreadyClosed,
        constraint = (channel.initiator == submitter.key() || channel.counterparty == submitter.key()) @ SssError::Unauthorized,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,
}

#[inline(never)]
pub fn submit_work_proof_handler(
    ctx: Context<SubmitWorkProof>,
    _channel_id: u64,
    task_hash: [u8; 32],
    output_hash: [u8; 32],
    proof_type: u8,
) -> Result<()> {
    // Store combined hash: hash(task_hash || output_hash) using the Solana
    // SHA-256 syscall. Previous XOR approach was insecure — XOR is commutative
    // and trivially invertible, allowing proof forgery.
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(&task_hash);
    combined[32..].copy_from_slice(&output_hash);
    let combined_hash = blake3::hash(&combined);

    let channel = &mut ctx.accounts.channel;
    channel.work_proof_hash = *combined_hash.as_bytes();

    emit!(WorkProofSubmitted {
        channel_id: channel.channel_id,
        initiator: channel.initiator,
        task_hash,
        output_hash,
        proof_type,
    });

    msg!(
        "APC: work proof submitted to channel {}, proof_type={}",
        channel.channel_id, proof_type,
    );
    Ok(())
}

// ─── settle (two-step: propose + countersign) ─────────────────────────────────

// Step 1: Initiator proposes a settlement amount.
#[derive(Accounts)]
#[instruction(channel_id: u64, amount: u64)]
pub struct ProposeSettle<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        mut,
        constraint = channel.status == ChannelStatus::Open @ SssError::ChannelAlreadyClosed,
        constraint = (channel.initiator == proposer.key() || channel.counterparty == proposer.key()) @ SssError::Unauthorized,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,

    #[account(
        init,
        payer = proposer,
        space = 8 + ProposedSettlement::INIT_SPACE,
        seeds = [ProposedSettlement::SEED, channel.key().as_ref()],
        bump,
    )]
    pub proposed_settlement: Box<Account<'info, ProposedSettlement>>,

    pub system_program: Program<'info, System>,
}

#[inline(never)]
pub fn propose_settle_handler(
    ctx: Context<ProposeSettle>,
    _channel_id: u64,
    amount: u64,
) -> Result<()> {
    require!(
        amount <= ctx.accounts.channel.initiator_deposit,
        SssError::InvalidSettleAmount
    );

    let ps = &mut ctx.accounts.proposed_settlement;
    ps.amount = amount;
    ps.proposed_by = ctx.accounts.proposer.key();
    ps.bump = ctx.bumps.proposed_settlement;

    msg!(
        "APC: settlement proposed for channel {}, amount={}",
        ctx.accounts.channel.channel_id, amount,
    );
    Ok(())
}

// Step 2: Other party countersigns, executing the settlement.
#[derive(Accounts)]
#[instruction(channel_id: u64, amount: u64)]
pub struct CountersignSettle<'info> {
    #[account(mut)]
    pub countersigner: Signer<'info>,

    #[account(
        mut,
        constraint = channel.status == ChannelStatus::Open @ SssError::ChannelAlreadyClosed,
        constraint = (channel.initiator == countersigner.key() || channel.counterparty == countersigner.key()) @ SssError::Unauthorized,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,

    #[account(
        mut,
        seeds = [ProposedSettlement::SEED, channel.key().as_ref()],
        bump = proposed_settlement.bump,
        constraint = proposed_settlement.proposed_by != countersigner.key() @ SssError::Unauthorized,
        close = countersigner,
    )]
    pub proposed_settlement: Box<Account<'info, ProposedSettlement>>,

    #[account(constraint = stable_mint.key() == channel.stable_mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == channel.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Counterparty's token account — receives the settlement amount.
    #[account(
        mut,
        constraint = counterparty_token_account.mint == stable_mint.key(),
        constraint = counterparty_token_account.owner == channel.counterparty,
    )]
    pub counterparty_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Initiator's token account — receives the remainder.
    #[account(
        mut,
        constraint = initiator_token_account.mint == stable_mint.key(),
        constraint = initiator_token_account.owner == channel.initiator,
    )]
    pub initiator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn countersign_settle_handler(
    ctx: Context<CountersignSettle>,
    _channel_id: u64,
    amount: u64,
) -> Result<()> {
    require!(
        amount == ctx.accounts.proposed_settlement.amount,
        SssError::SettlementNotMatching
    );
    require!(
        amount <= ctx.accounts.channel.initiator_deposit,
        SssError::InvalidSettleAmount
    );

    let initiator_key = ctx.accounts.channel.initiator;
    let channel_id_bytes = ctx.accounts.channel.channel_id.to_le_bytes();
    let bump = ctx.accounts.channel.bump;
    let bump_slice = &[bump];
    let seeds = channel_signer_seeds(initiator_key.as_ref(), &channel_id_bytes, bump_slice);
    let signer_seeds = &[&seeds[..]];

    // Transfer `amount` to counterparty.
    if amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.counterparty_token_account.to_account_info(),
                    authority: ctx.accounts.channel.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let remainder = ctx.accounts.channel.initiator_deposit.saturating_sub(amount);

    // Return remainder to initiator.
    if remainder > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.initiator_token_account.to_account_info(),
                    authority: ctx.accounts.channel.to_account_info(),
                },
                signer_seeds,
            ),
            remainder,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let channel = &mut ctx.accounts.channel;
    channel.status = ChannelStatus::Settled;

    emit!(ChannelSettled {
        channel_id: channel.channel_id,
        initiator: channel.initiator,
        counterparty: channel.counterparty,
        amount_to_counterparty: amount,
        amount_to_initiator: remainder,
    });

    msg!(
        "APC: channel {} settled — {} to counterparty, {} to initiator",
        channel.channel_id, amount, remainder,
    );
    Ok(())
}

// ─── dispute ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Dispute<'info> {
    /// Either party can raise a dispute.
    pub disputer: Signer<'info>,

    #[account(
        mut,
        constraint = channel.status == ChannelStatus::Open @ SssError::ChannelAlreadyClosed,
        constraint = (channel.initiator == disputer.key() || channel.counterparty == disputer.key()) @ SssError::Unauthorized,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,
}

#[inline(never)]
pub fn dispute_handler(
    ctx: Context<Dispute>,
    _channel_id: u64,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let channel = &mut ctx.accounts.channel;
    channel.work_proof_hash = evidence_hash;
    channel.status = ChannelStatus::Disputed;

    emit!(ChannelDisputed {
        channel_id: channel.channel_id,
        initiator: channel.initiator,
        counterparty: channel.counterparty,
        evidence_hash,
    });

    msg!("APC: channel {} disputed", channel.channel_id);
    Ok(())
}

// ─── force_close ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ForceClose<'info> {
    /// Only the initiator can force-close after timeout.
    pub initiator: Signer<'info>,

    #[account(
        mut,
        constraint = channel.initiator == initiator.key() @ SssError::Unauthorized,
        constraint = !channel.status.is_terminal() @ SssError::ChannelAlreadyClosed,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,

    #[account(constraint = stable_mint.key() == channel.stable_mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == channel.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = initiator_token_account.mint == stable_mint.key(),
        constraint = initiator_token_account.owner == initiator.key(),
    )]
    pub initiator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn force_close_handler(ctx: Context<ForceClose>, _channel_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot >= ctx.accounts.channel.open_slot.saturating_add(ctx.accounts.channel.timeout_slots),
        SssError::ChannelNotExpired
    );

    let deposit = ctx.accounts.channel.initiator_deposit;
    let initiator_key = ctx.accounts.channel.initiator;
    let channel_id_bytes = ctx.accounts.channel.channel_id.to_le_bytes();
    let bump = ctx.accounts.channel.bump;
    let bump_slice = &[bump];
    let seeds = channel_signer_seeds(initiator_key.as_ref(), &channel_id_bytes, bump_slice);
    let signer_seeds = &[&seeds[..]];

    if deposit > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.initiator_token_account.to_account_info(),
                    authority: ctx.accounts.channel.to_account_info(),
                },
                signer_seeds,
            ),
            deposit,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let channel = &mut ctx.accounts.channel;
    channel.status = ChannelStatus::ForceClose;

    emit!(ChannelForceClosed {
        channel_id: channel.channel_id,
        initiator: channel.initiator,
        amount_returned: deposit,
    });

    msg!(
        "APC: channel {} force-closed, {} tokens returned to initiator",
        channel.channel_id, deposit,
    );
    Ok(())
}

// ─── resolve_dispute ─────────────────────────────────────────────────────────
//
// Provides a resolution path for disputed channels. Without this, once a
// channel enters `Disputed` status the only exit is `force_close`, which
// always returns all funds to the initiator — ignoring the dispute entirely.
//
// Resolution requires EITHER:
//   (a) Both parties sign (mutual agreement), OR
//   (b) The stablecoin authority signs (arbitration).
//
// The `settlement_amount` specifies how much goes to the counterparty;
// the remainder is returned to the initiator.

#[derive(Accounts)]
#[instruction(channel_id: u64, settlement_amount: u64)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Initiator signer — required unless authority is resolving.
    /// CHECK: Validated in handler logic against channel.initiator.
    pub initiator_signer: UncheckedAccount<'info>,

    /// Counterparty signer — required unless authority is resolving.
    /// CHECK: Validated in handler logic against channel.counterparty.
    pub counterparty_signer: UncheckedAccount<'info>,

    /// Optional authority signer — if present and matches config.authority,
    /// both-party signatures are not required.
    /// CHECK: Validated in handler logic against config.authority.
    pub authority: UncheckedAccount<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, stable_mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        constraint = channel.status == ChannelStatus::Disputed @ SssError::ChannelAlreadyClosed,
    )]
    pub channel: Box<Account<'info, PaymentChannel>>,

    #[account(constraint = stable_mint.key() == channel.stable_mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == channel.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Counterparty's token account — receives the settlement amount.
    #[account(
        mut,
        constraint = counterparty_token_account.mint == stable_mint.key(),
        constraint = counterparty_token_account.owner == channel.counterparty,
    )]
    pub counterparty_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Initiator's token account — receives the remainder.
    #[account(
        mut,
        constraint = initiator_token_account.mint == stable_mint.key(),
        constraint = initiator_token_account.owner == channel.initiator,
    )]
    pub initiator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn resolve_dispute_handler(
    ctx: Context<ResolveDispute>,
    _channel_id: u64,
    settlement_amount: u64,
) -> Result<()> {
    // Authorization: either both parties sign, or the authority signs.
    let both_parties_signed = ctx.accounts.initiator_signer.is_signer
        && ctx.accounts.counterparty_signer.is_signer
        && ctx.accounts.initiator_signer.key() == ctx.accounts.channel.initiator
        && ctx.accounts.counterparty_signer.key() == ctx.accounts.channel.counterparty;

    let authority_signed = ctx.accounts.authority.is_signer
        && ctx.accounts.authority.key() == ctx.accounts.config.authority;

    require!(
        both_parties_signed || authority_signed,
        SssError::Unauthorized
    );

    let deposit = ctx.accounts.channel.initiator_deposit;
    require!(settlement_amount <= deposit, SssError::InvalidSettleAmount);

    let initiator_key = ctx.accounts.channel.initiator;
    let channel_id_bytes = ctx.accounts.channel.channel_id.to_le_bytes();
    let bump = ctx.accounts.channel.bump;
    let bump_slice = &[bump];
    let seeds = channel_signer_seeds(initiator_key.as_ref(), &channel_id_bytes, bump_slice);
    let signer_seeds = &[&seeds[..]];

    // Transfer settlement_amount to counterparty.
    if settlement_amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.counterparty_token_account.to_account_info(),
                    authority: ctx.accounts.channel.to_account_info(),
                },
                signer_seeds,
            ),
            settlement_amount,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let remainder = deposit.saturating_sub(settlement_amount);

    // Return remainder to initiator.
    if remainder > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.initiator_token_account.to_account_info(),
                    authority: ctx.accounts.channel.to_account_info(),
                },
                signer_seeds,
            ),
            remainder,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let channel = &mut ctx.accounts.channel;
    channel.status = ChannelStatus::Settled;

    emit!(DisputeResolved {
        channel_id: channel.channel_id,
        initiator: channel.initiator,
        counterparty: channel.counterparty,
        amount_to_counterparty: settlement_amount,
        amount_to_initiator: remainder,
    });

    msg!(
        "APC: dispute resolved for channel {} — {} to counterparty, {} to initiator",
        channel.channel_id, settlement_amount, remainder,
    );
    Ok(())
}
