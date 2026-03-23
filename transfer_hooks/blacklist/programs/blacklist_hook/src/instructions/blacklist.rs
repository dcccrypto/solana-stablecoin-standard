use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::error::BlacklistError;
use crate::events::{BlacklistEntryClosed, EvidenceUpdated, WalletBlacklisted, WalletUnblacklisted};
use crate::state::{BlacklistEntry, Config};

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
#[event_cpi]
pub struct SetBlacklist<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + BlacklistEntry::INIT_SPACE,
        seeds = [BLACKLIST_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn add_to_blacklist(
    ctx: Context<SetBlacklist>,
    wallet: Pubkey,
    reason: String,
    evidence_hash: [u8; 32],
    evidence_uri: String,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        BlacklistError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.config.mint,
        ctx.accounts.mint.key(),
        BlacklistError::MintMismatch
    );

    let entry = &mut ctx.accounts.blacklist_entry;
    entry.wallet = wallet;
    entry.mint = ctx.accounts.mint.key();
    entry.blocked = true;
    entry.reason = reason.clone();
    entry.evidence_hash = evidence_hash;
    entry.evidence_uri = evidence_uri.clone();
    entry.bump = ctx.bumps.blacklist_entry;

    emit_cpi!(WalletBlacklisted {
        mint: ctx.accounts.mint.key(),
        wallet,
        authority: ctx.accounts.admin.key(),
        reason,
        evidence_hash,
        evidence_uri,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

pub fn remove_from_blacklist(ctx: Context<SetBlacklist>, wallet: Pubkey) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        BlacklistError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.config.mint,
        ctx.accounts.mint.key(),
        BlacklistError::MintMismatch
    );

    let entry = &mut ctx.accounts.blacklist_entry;
    entry.wallet = wallet;
    entry.mint = ctx.accounts.mint.key();
    entry.blocked = false;
    entry.bump = ctx.bumps.blacklist_entry;

    emit_cpi!(WalletUnblacklisted {
        mint: ctx.accounts.mint.key(),
        wallet,
        authority: ctx.accounts.admin.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
#[event_cpi]
pub struct CloseBlacklistEntry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        close = admin,
        seeds = [BLACKLIST_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump = blacklist_entry.bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
}

pub fn close_blacklist_entry(
    ctx: Context<CloseBlacklistEntry>,
    _wallet: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        BlacklistError::Unauthorized
    );
    require!(
        !ctx.accounts.blacklist_entry.blocked,
        BlacklistError::CannotCloseBlockedEntry
    );

    emit_cpi!(BlacklistEntryClosed {
        mint: ctx.accounts.mint.key(),
        wallet: ctx.accounts.blacklist_entry.wallet,
        authority: ctx.accounts.admin.key(),
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
#[event_cpi]
pub struct UpdateEvidence<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [BLACKLIST_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump = blacklist_entry.bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
}

pub fn update_blacklist_evidence(
    ctx: Context<UpdateEvidence>,
    _wallet: Pubkey,
    new_evidence_hash: [u8; 32],
    new_evidence_uri: String,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        BlacklistError::Unauthorized
    );
    require!(
        ctx.accounts.blacklist_entry.blocked,
        BlacklistError::WalletNotBlocked
    );

    let entry = &mut ctx.accounts.blacklist_entry;
    let previous_hash = entry.evidence_hash;
    entry.evidence_hash = new_evidence_hash;
    entry.evidence_uri = new_evidence_uri.clone();

    emit_cpi!(EvidenceUpdated {
        mint: ctx.accounts.mint.key(),
        wallet: entry.wallet,
        authority: ctx.accounts.admin.key(),
        previous_hash,
        new_hash: new_evidence_hash,
        evidence_uri: new_evidence_uri,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
