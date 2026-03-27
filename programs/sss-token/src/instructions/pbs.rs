//! SSS-109 — Probabilistic Balance Standard (PBS)
//!
//! Implements a trustless "pay on proof" primitive: an issuer locks stablecoin
//! tokens in a ProbabilisticVault PDA conditioned on a hash-based proof.
//! The claimant (or oracle attestation) submits the matching proof to release.
//!
//! # Instructions
//! - `commit_probabilistic` — lock funds, create vault
//! - `prove_and_resolve`   — full release on proof match
//! - `partial_resolve`     — partial release on proof match
//! - `expire_and_refund`   — refund issuer after expiry_slot
//!
//! # ProbabilisticVault PDA
//! Seeds: [b"pbs-vault", config, commitment_id.to_le_bytes()]
//! Escrow token account must be owned by the vault PDA.
//!
//! # Feature flag
//! FLAG_PROBABILISTIC_MONEY (1 << 6) must be set on StablecoinConfig.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::{ProbabilisticCommitmentCreated, ProbabilisticCommitmentResolved};
use crate::state::{StablecoinConfig, FLAG_PROBABILISTIC_MONEY};

// ─── Vault status ─────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum VaultStatus {
    Pending = 0,
    Resolved = 1,
    Expired = 2,
    PartiallyResolved = 3,
}

// ─── ProbabilisticVault account ───────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct ProbabilisticVault {
    /// Config PDA this vault belongs to (needed for PDA signing).
    pub config: Pubkey,
    /// Issuer who locked the funds.
    pub issuer: Pubkey,
    /// Claimant authorised to receive funds on proof.
    pub claimant: Pubkey,
    /// SSS stablecoin mint.
    pub stable_mint: Pubkey,
    /// Total tokens committed into escrow.
    pub committed_amount: u64,
    /// Amount released so far (sum of all partial + full releases).
    pub resolved_amount: u64,
    /// SHA-256 / oracle hash the proof must match.
    pub condition_hash: [u8; 32],
    /// Slot after which `expire_and_refund` is allowed.
    pub expiry_slot: u64,
    /// Monotonic commitment id (caller-provided, must be unique per config).
    pub commitment_id: u64,
    /// Current vault lifecycle status.
    pub status: VaultStatus,
    /// PDA bump seed.
    pub bump: u8,
}

impl ProbabilisticVault {
    pub const SEED: &'static [u8] = b"pbs-vault";

    /// True when the vault is in a terminal state (no further mutations allowed).
    pub fn is_terminal(&self) -> bool {
        matches!(self.status, VaultStatus::Resolved | VaultStatus::Expired)
    }

    /// Remaining unlocked amount.
    pub fn remaining(&self) -> u64 {
        self.committed_amount.saturating_sub(self.resolved_amount)
    }
}

// ─── Helper: vault PDA signer seeds ──────────────────────────────────────────

/// Returns the owned seed bytes needed to produce a signer for the vault PDA.
/// Caller is responsible for keeping the returned vecs alive for the duration
/// of the CPI.
fn vault_signer_seeds<'a>(
    config_key: &'a [u8],
    commitment_id_bytes: &'a [u8],
    bump: &'a [u8],
) -> [&'a [u8]; 4] {
    [ProbabilisticVault::SEED, config_key, commitment_id_bytes, bump]
}

// ─── commit_probabilistic ─────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CommitProbabilisticParams {
    pub amount: u64,
    pub condition_hash: [u8; 32],
    pub expiry_slot: u64,
    pub commitment_id: u64,
    pub claimant: Pubkey,
}

#[derive(Accounts)]
#[instruction(params: CommitProbabilisticParams)]
pub struct CommitProbabilistic<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, stable_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset >= 1 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
        constraint = config.feature_flags & FLAG_PROBABILISTIC_MONEY != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(constraint = stable_mint.key() == config.mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = issuer,
        space = 8 + ProbabilisticVault::INIT_SPACE,
        seeds = [
            ProbabilisticVault::SEED,
            config.key().as_ref(),
            &params.commitment_id.to_le_bytes(),
        ],
        bump,
    )]
    pub vault: Box<Account<'info, ProbabilisticVault>>,

    /// Escrow token account — must be owned by the vault PDA, pre-created by client.
    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == vault.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Issuer's token account (source).
    #[account(
        mut,
        constraint = issuer_token_account.mint == stable_mint.key(),
        constraint = issuer_token_account.owner == issuer.key(),
    )]
    pub issuer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[inline(never)]
pub fn commit_probabilistic_handler(
    ctx: Context<CommitProbabilistic>,
    params: CommitProbabilisticParams,
) -> Result<()> {
    require!(params.amount > 0, SssError::ZeroAmount);
    let clock = Clock::get()?;
    require!(params.expiry_slot > clock.slot, SssError::InvalidExpirySlot);

    // Transfer tokens issuer → escrow (issuer signs directly).
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.issuer_token_account.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.issuer.to_account_info(),
            },
        ),
        params.amount,
        ctx.accounts.stable_mint.decimals,
    )?;

    let vault = &mut ctx.accounts.vault;
    vault.config = ctx.accounts.config.key();
    vault.issuer = ctx.accounts.issuer.key();
    vault.claimant = params.claimant;
    vault.stable_mint = ctx.accounts.stable_mint.key();
    vault.committed_amount = params.amount;
    vault.resolved_amount = 0;
    vault.condition_hash = params.condition_hash;
    vault.expiry_slot = params.expiry_slot;
    vault.commitment_id = params.commitment_id;
    vault.status = VaultStatus::Pending;
    vault.bump = ctx.bumps.vault;

    emit!(ProbabilisticCommitmentCreated {
        config: ctx.accounts.config.key(),
        commitment_id: params.commitment_id,
        issuer: ctx.accounts.issuer.key(),
        claimant: params.claimant,
        stable_mint: ctx.accounts.stable_mint.key(),
        committed_amount: params.amount,
        condition_hash: params.condition_hash,
        expiry_slot: params.expiry_slot,
    });

    msg!(
        "PBS: committed {} tokens. id={} expiry_slot={}",
        params.amount, params.commitment_id, params.expiry_slot,
    );
    Ok(())
}

// ─── prove_and_resolve ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ProveAndResolve<'info> {
    /// The claimant — must match vault.claimant.
    pub claimant: Signer<'info>,

    #[account(
        mut,
        constraint = vault.claimant == claimant.key() @ SssError::Unauthorized,
        constraint = !vault.is_terminal() @ SssError::VaultAlreadyTerminal,
    )]
    pub vault: Box<Account<'info, ProbabilisticVault>>,

    #[account(constraint = stable_mint.key() == vault.stable_mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == vault.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = claimant_token_account.mint == stable_mint.key(),
        constraint = claimant_token_account.owner == claimant.key(),
    )]
    pub claimant_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn prove_and_resolve_handler(
    ctx: Context<ProveAndResolve>,
    proof_hash: [u8; 32],
) -> Result<()> {
    require!(
        proof_hash == ctx.accounts.vault.condition_hash,
        SssError::ProofHashMismatch
    );

    let remaining = ctx.accounts.vault.remaining();
    require!(remaining > 0, SssError::ZeroAmount);

    // Vault PDA signs: seeds [b"pbs-vault", config, commitment_id_le8, bump]
    let config_key = ctx.accounts.vault.config;
    let commitment_id_bytes = ctx.accounts.vault.commitment_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let bump_slice = &[bump];

    let seeds = vault_signer_seeds(config_key.as_ref(), &commitment_id_bytes, bump_slice);
    let signer_seeds = &[&seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.claimant_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        remaining,
        ctx.accounts.stable_mint.decimals,
    )?;

    let vault = &mut ctx.accounts.vault;
    vault.resolved_amount = vault.committed_amount;
    vault.status = VaultStatus::Resolved;

    emit!(ProbabilisticCommitmentResolved {
        config: vault.config,
        commitment_id: vault.commitment_id,
        claimant: vault.claimant,
        amount_released: remaining,
        partial: false,
    });

    msg!(
        "PBS: resolved id={}, released {} tokens to claimant",
        vault.commitment_id, remaining,
    );
    Ok(())
}

// ─── partial_resolve ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct PartialResolve<'info> {
    pub claimant: Signer<'info>,

    #[account(
        mut,
        constraint = vault.claimant == claimant.key() @ SssError::Unauthorized,
        constraint = !vault.is_terminal() @ SssError::VaultAlreadyTerminal,
    )]
    pub vault: Box<Account<'info, ProbabilisticVault>>,

    #[account(constraint = stable_mint.key() == vault.stable_mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == vault.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = claimant_token_account.mint == stable_mint.key(),
        constraint = claimant_token_account.owner == claimant.key(),
    )]
    pub claimant_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Issuer's token account — receives the remainder on partial resolution.
    #[account(
        mut,
        constraint = issuer_token_account.mint == stable_mint.key(),
        constraint = issuer_token_account.owner == vault.issuer,
    )]
    pub issuer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn partial_resolve_handler(
    ctx: Context<PartialResolve>,
    amount: u64,
    proof_hash: [u8; 32],
) -> Result<()> {
    require!(
        proof_hash == ctx.accounts.vault.condition_hash,
        SssError::ProofHashMismatch
    );

    let remaining = ctx.accounts.vault.remaining();
    require!(amount > 0, SssError::ZeroAmount);
    require!(amount <= remaining, SssError::InvalidAmount);

    let config_key = ctx.accounts.vault.config;
    let commitment_id_bytes = ctx.accounts.vault.commitment_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let bump_slice = &[bump];
    let seeds = vault_signer_seeds(config_key.as_ref(), &commitment_id_bytes, bump_slice);
    let signer_seeds = &[&seeds[..]];

    // Release `amount` to claimant
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.claimant_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.stable_mint.decimals,
    )?;

    let remainder = remaining.saturating_sub(amount);

    // Return remainder to issuer immediately (close the escrow early)
    if remainder > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.issuer_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            remainder,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let vault = &mut ctx.accounts.vault;
    vault.resolved_amount = vault.resolved_amount.saturating_add(amount);
    vault.status = VaultStatus::PartiallyResolved;

    emit!(ProbabilisticCommitmentResolved {
        config: vault.config,
        commitment_id: vault.commitment_id,
        claimant: vault.claimant,
        amount_released: amount,
        partial: true,
    });

    msg!(
        "PBS: partial_resolve id={}, released {} to claimant, {} returned to issuer",
        vault.commitment_id, amount, remainder,
    );
    Ok(())
}

// ─── expire_and_refund ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ExpireAndRefund<'info> {
    /// Anyone can call expire — permissionless, checked by slot.
    pub caller: Signer<'info>,

    #[account(
        mut,
        constraint = !vault.is_terminal() @ SssError::VaultAlreadyTerminal,
    )]
    pub vault: Box<Account<'info, ProbabilisticVault>>,

    #[account(constraint = stable_mint.key() == vault.stable_mint)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = escrow_token_account.mint == stable_mint.key(),
        constraint = escrow_token_account.owner == vault.key(),
    )]
    pub escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Issuer's token account — receives refund.
    #[account(
        mut,
        constraint = issuer_token_account.mint == stable_mint.key(),
        constraint = issuer_token_account.owner == vault.issuer,
    )]
    pub issuer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[inline(never)]
pub fn expire_and_refund_handler(ctx: Context<ExpireAndRefund>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot >= ctx.accounts.vault.expiry_slot,
        SssError::VaultNotExpired
    );

    let remaining = ctx.accounts.vault.remaining();
    // If nothing remains (e.g. partial resolve consumed everything), just mark expired.
    let config_key = ctx.accounts.vault.config;
    let commitment_id_bytes = ctx.accounts.vault.commitment_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let bump_slice = &[bump];
    let seeds = vault_signer_seeds(config_key.as_ref(), &commitment_id_bytes, bump_slice);
    let signer_seeds = &[&seeds[..]];

    if remaining > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    mint: ctx.accounts.stable_mint.to_account_info(),
                    to: ctx.accounts.issuer_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            remaining,
            ctx.accounts.stable_mint.decimals,
        )?;
    }

    let vault = &mut ctx.accounts.vault;
    vault.status = VaultStatus::Expired;

    msg!(
        "PBS: expired id={}, refunded {} tokens to issuer",
        vault.commitment_id, remaining,
    );
    Ok(())
}
