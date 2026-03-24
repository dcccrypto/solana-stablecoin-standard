use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::{SanctionsOracleCleared, SanctionsOracleSet, SanctionsRecordUpdated};
use crate::state::{SanctionsRecord, StablecoinConfig, FLAG_SANCTIONS_ORACLE};

// ---------------------------------------------------------------------------
// SSS-128: Sanctions screening oracle — pluggable OFAC/sanctions list integration
// ---------------------------------------------------------------------------
//
// Architecture:
//   1. Authority calls `set_sanctions_oracle(oracle, max_staleness_slots)` to
//      register a compliance provider (Chainalysis, Elliptic, TRM, etc.) as the
//      oracle signer.  This enables FLAG_SANCTIONS_ORACLE on the config.
//   2. Oracle signer calls `update_sanctions_record(wallet, is_sanctioned)` to
//      create/update `SanctionsRecord` PDAs in the sss-token program.
//   3. Transfer hook reads `SanctionsRecord` for the sender.  If is_sanctioned
//      == true (and record is fresh), the transfer is rejected with SanctionedAddress.
//   4. Authority calls `clear_sanctions_oracle()` to disable the oracle path.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// set_sanctions_oracle — authority registers an oracle + staleness window
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetSanctionsOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn set_sanctions_oracle_handler(
    ctx: Context<SetSanctionsOracle>,
    oracle: Pubkey,
    max_staleness_slots: u64,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;

    config.sanctions_oracle = oracle;
    config.sanctions_max_staleness_slots = max_staleness_slots;
    config.feature_flags |= FLAG_SANCTIONS_ORACLE;

    emit!(SanctionsOracleSet {
        mint: config.mint,
        oracle,
        max_staleness_slots,
    });

    msg!(
        "SanctionsOracle set: mint={} oracle={} max_staleness_slots={}",
        config.mint,
        oracle,
        max_staleness_slots,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// clear_sanctions_oracle — authority disables the oracle path
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClearSanctionsOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn clear_sanctions_oracle_handler(ctx: Context<ClearSanctionsOracle>) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;

    config.sanctions_oracle = Pubkey::default();
    config.sanctions_max_staleness_slots = 0;
    config.feature_flags &= !FLAG_SANCTIONS_ORACLE;

    emit!(SanctionsOracleCleared { mint: config.mint });

    msg!("SanctionsOracle cleared: mint={}", config.mint);
    Ok(())
}

// ---------------------------------------------------------------------------
// update_sanctions_record — oracle signer creates/updates a wallet's record
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(wallet: Pubkey, is_sanctioned: bool)]
pub struct UpdateSanctionsRecord<'info> {
    /// The oracle signer registered on the config (must match config.sanctions_oracle).
    #[account(mut)]
    pub oracle: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.check_feature_flag(FLAG_SANCTIONS_ORACLE) @ SssError::FeatureNotEnabled,
        constraint = config.sanctions_oracle == oracle.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init_if_needed,
        payer = oracle,
        space = 8 + SanctionsRecord::INIT_SPACE,
        seeds = [
            SanctionsRecord::SEED,
            config.mint.as_ref(),
            wallet.as_ref(),
        ],
        bump,
    )]
    pub sanctions_record: Account<'info, SanctionsRecord>,

    pub system_program: Program<'info, System>,
}

pub fn update_sanctions_record_handler(
    ctx: Context<UpdateSanctionsRecord>,
    wallet: Pubkey,
    is_sanctioned: bool,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let record = &mut ctx.accounts.sanctions_record;
    let clock = Clock::get()?;

    record.is_sanctioned = is_sanctioned;
    record.updated_slot = clock.slot;
    record.bump = ctx.bumps.sanctions_record;

    emit!(SanctionsRecordUpdated {
        mint: config.mint,
        wallet,
        is_sanctioned,
        slot: clock.slot,
    });

    msg!(
        "SanctionsRecord updated: mint={} wallet={} is_sanctioned={} slot={}",
        config.mint,
        wallet,
        is_sanctioned,
        clock.slot,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// close_sanctions_record — oracle signer reclaims rent for cleared records
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct CloseSanctionsRecord<'info> {
    /// The oracle signer registered on the config.
    #[account(mut)]
    pub oracle: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.sanctions_oracle == oracle.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [
            SanctionsRecord::SEED,
            config.mint.as_ref(),
            wallet.as_ref(),
        ],
        bump = sanctions_record.bump,
        close = oracle,
    )]
    pub sanctions_record: Account<'info, SanctionsRecord>,
}

pub fn close_sanctions_record_handler(
    _ctx: Context<CloseSanctionsRecord>,
    _wallet: Pubkey,
) -> Result<()> {
    msg!("SanctionsRecord closed — rent reclaimed");
    Ok(())
}

// ---------------------------------------------------------------------------
// verify_sanctions_if_required — called from transfer hook logic
// ---------------------------------------------------------------------------

/// Check whether a sender is sanctioned and reject if so.
///
/// No-op when FLAG_SANCTIONS_ORACLE is not set or sanctions_oracle is default.
/// Returns SanctionedAddress if is_sanctioned == true and record is fresh enough.
pub fn verify_sanctions_if_required(
    config: &StablecoinConfig,
    record: Option<&SanctionsRecord>,
    current_slot: u64,
) -> Result<()> {
    if !config.check_feature_flag(FLAG_SANCTIONS_ORACLE) {
        return Ok(());
    }
    if config.sanctions_oracle == Pubkey::default() {
        return Ok(());
    }

    let record = match record {
        Some(r) => r,
        // No record = not sanctioned (oracle hasn't flagged this wallet)
        None => return Ok(()),
    };

    if !record.is_sanctioned {
        return Ok(());
    }

    // Staleness check: if max_staleness_slots > 0 and record is too old, reject as stale.
    let max_staleness = config.sanctions_max_staleness_slots;
    if max_staleness > 0 {
        let age = current_slot.saturating_sub(record.updated_slot);
        require!(age <= max_staleness, SssError::SanctionsRecordStale);
    }

    // Record is fresh and is_sanctioned — block the transfer.
    Err(error!(SssError::SanctionedAddress))
}
