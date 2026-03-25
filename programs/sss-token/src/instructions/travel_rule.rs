use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::TravelRuleRecordSubmitted;
use crate::state::{StablecoinConfig, TravelRuleRecord, FLAG_TRAVEL_RULE};

// ---------------------------------------------------------------------------
// SSS-127: Travel Rule compliance hooks — VASP-to-VASP data sharing
// ---------------------------------------------------------------------------
//
// FATF Travel Rule requires VASPs to share originator/beneficiary data for
// transfers above a threshold (commonly USD 1 000 / EUR 1 000).
//
// Flow:
//   1. Sending VASP constructs `TravelRuleRecord` payload (encrypted to
//      beneficiary VASP key using an off-chain ECIES scheme).
//   2. In the *same transaction* as the transfer, call
//      `submit_travel_rule_record` — this creates the PDA.
//   3. The transfer hook (when FLAG_TRAVEL_RULE is active and
//      amount >= travel_rule_threshold) calls `verify_travel_rule_if_required`
//      to confirm the PDA exists and amounts match.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// set_travel_rule_threshold — authority configures the threshold (0 = off)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetTravelRuleThreshold<'info> {
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

pub fn set_travel_rule_threshold_handler(
    ctx: Context<SetTravelRuleThreshold>,
    threshold: u64,
) -> Result<()> {
    // BUG-010: block direct call when timelock is active.
    crate::instructions::admin_timelock::require_timelock_executed(
        &ctx.accounts.config,
        crate::state::ADMIN_OP_SET_TRAVEL_RULE_THRESHOLD,
    )?;

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;

    // If FLAG_TRAVEL_RULE is being left enabled, threshold must be > 0.
    // (Caller is responsible for also toggling the flag via feature_flags instructions.)
    if config.check_feature_flag(FLAG_TRAVEL_RULE) {
        require!(threshold > 0, SssError::TravelRuleThresholdNotSet);
    }

    config.travel_rule_threshold = threshold;

    msg!(
        "TravelRule threshold set: mint={} threshold={}",
        config.mint,
        threshold,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// submit_travel_rule_record — VASP submits encrypted data before transfer
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct SubmitTravelRuleRecord<'info> {
    /// The VASP operator submitting the record (pays rent).
    #[account(mut)]
    pub originator_vasp_signer: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = originator_vasp_signer,
        space = 8 + TravelRuleRecord::INIT_SPACE,
        seeds = [
            TravelRuleRecord::SEED,
            config.mint.as_ref(),
            &nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub travel_rule_record: Account<'info, TravelRuleRecord>,

    pub system_program: Program<'info, System>,
}

/// Submit a Travel Rule record for a qualifying transfer.
///
/// # Arguments
/// * `nonce`           – Caller-chosen monotonic nonce; must be unique per transfer.
/// * `encrypted_payload` – 256-byte VASP payload (encrypted to beneficiary VASP key).
/// * `beneficiary_vasp` – Pubkey of the beneficiary VASP.
/// * `transfer_amount`  – Exact amount of the accompanying transfer.
pub fn submit_travel_rule_record_handler(
    ctx: Context<SubmitTravelRuleRecord>,
    nonce: u64,
    encrypted_payload: [u8; 256],
    beneficiary_vasp: Pubkey,
    transfer_amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let record = &mut ctx.accounts.travel_rule_record;
    let clock = Clock::get()?;

    require!(transfer_amount > 0, SssError::InvalidAmount);

    // If FLAG_TRAVEL_RULE is active, enforce threshold is configured.
    if config.check_feature_flag(FLAG_TRAVEL_RULE) {
        require!(
            config.travel_rule_threshold > 0,
            SssError::TravelRuleThresholdNotSet
        );
    }

    record.sss_mint = config.mint;
    record.nonce = nonce;
    record.encrypted_payload = encrypted_payload;
    record.originator_vasp = ctx.accounts.originator_vasp_signer.key();
    record.beneficiary_vasp = beneficiary_vasp;
    record.transfer_amount = transfer_amount;
    record.slot = clock.slot;
    record.bump = ctx.bumps.travel_rule_record;

    emit!(TravelRuleRecordSubmitted {
        mint: config.mint,
        nonce,
        originator_vasp: record.originator_vasp,
        beneficiary_vasp,
        transfer_amount,
        slot: clock.slot,
    });

    msg!(
        "TravelRuleRecord submitted: mint={} nonce={} amount={} beneficiary_vasp={}",
        config.mint,
        nonce,
        transfer_amount,
        beneficiary_vasp,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// verify_travel_rule_if_required — called by transfer hook logic
// ---------------------------------------------------------------------------

/// Check whether a Travel Rule record is required for this transfer, and if so,
/// that the provided record matches expected amount and beneficiary VASP.
///
/// This function is called from transfer hook logic (not a standalone instruction).
/// It is a no-op when FLAG_TRAVEL_RULE is not set or amount < threshold.
pub fn verify_travel_rule_if_required(
    config: &StablecoinConfig,
    record: Option<&TravelRuleRecord>,
    transfer_amount: u64,
    expected_beneficiary_vasp: Pubkey,
) -> Result<()> {
    if !config.check_feature_flag(FLAG_TRAVEL_RULE) {
        return Ok(());
    }
    let threshold = config.travel_rule_threshold;
    if threshold == 0 || transfer_amount < threshold {
        return Ok(());
    }

    // Travel Rule applies — record must exist and match.
    let record = record.ok_or(SssError::TravelRuleRequired)?;

    require!(
        record.sss_mint == config.mint,
        SssError::TravelRuleRecordInvalid
    );
    require!(
        record.transfer_amount == transfer_amount,
        SssError::TravelRuleRecordInvalid
    );
    require!(
        record.beneficiary_vasp == expected_beneficiary_vasp,
        SssError::TravelRuleRecordInvalid
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// close_travel_rule_record — originator can reclaim rent after transfer settles
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CloseTravelRuleRecord<'info> {
    #[account(mut)]
    pub originator_vasp_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            TravelRuleRecord::SEED,
            travel_rule_record.sss_mint.as_ref(),
            &nonce.to_le_bytes(),
        ],
        bump = travel_rule_record.bump,
        constraint = travel_rule_record.originator_vasp == originator_vasp_signer.key() @ SssError::Unauthorized,
        close = originator_vasp_signer,
    )]
    pub travel_rule_record: Account<'info, TravelRuleRecord>,
}

pub fn close_travel_rule_record_handler(
    _ctx: Context<CloseTravelRuleRecord>,
    _nonce: u64,
) -> Result<()> {
    msg!("TravelRuleRecord closed — rent reclaimed");
    Ok(())
}
