//! SSS-085 Fix 2 — Admin Timelock (BUG-010: extended to ALL ~17 privileged ops)
//!
//! All critical single-authority admin operations are delayed by a minimum of
//! `config.admin_timelock_delay` slots (default 432 000 slots ≈ 2 Solana epochs / ~2 days).
//!
//! Lifecycle:
//!  1. Authority calls `propose_timelocked_op` — stores op + mature slot.
//!  2. After `admin_op_mature_slot` is reached, authority calls `execute_timelocked_op`.
//!  3. Authority may call `cancel_timelocked_op` at any time before execution.
//!
//! BUG-010: Previously only authority_transfer, set/clear_feature_flag were
//! timelocked.  This module now covers ALL privileged ops listed below.
//!
//! This prevents a compromised key from draining the protocol in a single block.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{
    StablecoinConfig, ADMIN_OP_CLEAR_FEATURE_FLAG, ADMIN_OP_NONE,
    ADMIN_OP_PAUSE, ADMIN_OP_SET_BACKSTOP_PARAMS, ADMIN_OP_SET_FEATURE_FLAG,
    ADMIN_OP_SET_MIN_RESERVE_RATIO, ADMIN_OP_SET_ORACLE_CONFIG, ADMIN_OP_SET_ORACLE_PARAMS,
    ADMIN_OP_SET_PSM_FEE, ADMIN_OP_SET_PYTH_FEED, ADMIN_OP_SET_SANCTIONS_PARAMS,
    ADMIN_OP_SET_SPEND_LIMIT, ADMIN_OP_SET_STABILITY_FEE, ADMIN_OP_SET_TIMELOCK_DELAY,
    ADMIN_OP_SET_TRAVEL_RULE_THRESHOLD, ADMIN_OP_TRANSFER_AUTHORITY,
    ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY, ADMIN_OP_UNPAUSE, DEFAULT_ADMIN_TIMELOCK_DELAY,
    FLAG_SQUADS_AUTHORITY,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Verify that the calling instruction was preceded by a completed timelock
/// execution for the given op kind.  Used by legacy direct-call handlers to
/// enforce that they can only be reached after a timelock has been applied.
///
/// When `admin_timelock_delay == 0` the guard is skipped so that tests and
/// newly-initialized deployments (before timelock is configured) still work.
pub fn require_timelock_executed(config: &StablecoinConfig, op_kind: u8) -> Result<()> {
    if config.admin_timelock_delay == 0 {
        return Ok(());
    }
    // The op was just executed: admin_op_kind was cleared to ADMIN_OP_NONE,
    // but we can't check "what was just cleared" in the same instruction.
    // Solution: the ONLY path to mutate these fields is execute_timelocked_op,
    // which clears admin_op_kind after applying the change.  Direct handlers
    // are now gated: they MUST be bypassed in favour of the execute path.
    // Returning an error here makes direct-call paths unreachable when timelock > 0.
    err!(SssError::TimelockRequired)
}

// ---------------------------------------------------------------------------
// propose_timelocked_op
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ProposeTimelockOp<'info> {
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

    pub token_program: Interface<'info, TokenInterface>,
}

/// Propose a timelocked admin operation.
///
/// All privileged ops are routed through this single entry point.
/// Parameter encoding per op_kind:
///
/// | op_kind | op                            | param                                          | target                     |
/// |---------|-------------------------------|------------------------------------------------|----------------------------|
/// | 1       | TRANSFER_AUTHORITY            | 0                                              | new authority pubkey       |
/// | 2       | SET_FEATURE_FLAG              | flag bits to set                               | Pubkey::default()          |
/// | 3       | CLEAR_FEATURE_FLAG            | flag bits to clear                             | Pubkey::default()          |
/// | 4       | SET_PYTH_FEED                 | 0                                              | new feed pubkey            |
/// | 5       | SET_ORACLE_PARAMS             | (max_age_secs as u64) << 16 \| max_conf_bps   | Pubkey::default()          |
/// | 6       | SET_STABILITY_FEE             | fee_bps as u64                                 | Pubkey::default()          |
/// | 7       | SET_PSM_FEE                   | fee_bps as u64                                 | Pubkey::default()          |
/// | 8       | SET_BACKSTOP_PARAMS           | max_backstop_bps as u64                        | insurance fund vault pubkey|
/// | 9       | SET_SPEND_LIMIT               | max_transfer_amount                            | Pubkey::default()          |
/// | 10      | TRANSFER_COMPLIANCE_AUTHORITY | 0                                              | new compliance authority   |
/// | 11      | SET_ORACLE_CONFIG             | oracle_type as u64                             | oracle_feed pubkey         |
/// | 12      | SET_MIN_RESERVE_RATIO         | min_reserve_ratio_bps as u64                   | Pubkey::default()          |
/// | 13      | SET_TRAVEL_RULE_THRESHOLD     | threshold in token native units                | Pubkey::default()          |
/// | 14      | SET_SANCTIONS_PARAMS          | max_staleness_slots                            | sanctions oracle pubkey    |
/// | 15      | SET_TIMELOCK_DELAY            | new delay in slots                             | Pubkey::default()          |
/// | 16      | PAUSE                         | 0                                              | Pubkey::default()          |
/// | 17      | UNPAUSE                       | 0                                              | Pubkey::default()          |
///
/// Overwrites any existing pending op (only one pending op at a time).
pub fn propose_timelocked_op_handler(
    ctx: Context<ProposeTimelockOp>,
    op_kind: u8,
    param: u64,
    target: Pubkey,
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

    // BUG-018 / SSS-121: Block ADMIN_OP_UNPAUSE at proposal time to prevent
    // bypassing the guardian 24h pause override.
    require!(op_kind != ADMIN_OP_UNPAUSE, SssError::InstructionDisabled);

    require!(
        matches!(
            op_kind,
            ADMIN_OP_TRANSFER_AUTHORITY
                | ADMIN_OP_SET_FEATURE_FLAG
                | ADMIN_OP_CLEAR_FEATURE_FLAG
                | ADMIN_OP_SET_PYTH_FEED
                | ADMIN_OP_SET_ORACLE_PARAMS
                | ADMIN_OP_SET_STABILITY_FEE
                | ADMIN_OP_SET_PSM_FEE
                | ADMIN_OP_SET_BACKSTOP_PARAMS
                | ADMIN_OP_SET_SPEND_LIMIT
                | ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY
                | ADMIN_OP_SET_ORACLE_CONFIG
                | ADMIN_OP_SET_MIN_RESERVE_RATIO
                | ADMIN_OP_SET_TRAVEL_RULE_THRESHOLD
                | ADMIN_OP_SET_SANCTIONS_PARAMS
                | ADMIN_OP_SET_TIMELOCK_DELAY
                | ADMIN_OP_PAUSE
        ),
        SssError::InvalidTimelockOpKind
    );

    let clock = Clock::get()?;
    let config = &mut ctx.accounts.config;
    let delay = config.admin_timelock_delay;

    // BUG-019: Compliance authority transfer always enforces the full DEFAULT_ADMIN_TIMELOCK_DELAY
    // (432_000 slots ≈ 48h) regardless of the configured admin_timelock_delay.
    // This prevents a compromised authority from reducing the timelock delay and then
    // immediately transferring the compliance authority in two transactions.
    let effective_delay = if op_kind == ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY {
        delay.max(DEFAULT_ADMIN_TIMELOCK_DELAY)
    } else {
        delay
    };

    let mature_slot = clock.slot.checked_add(effective_delay).ok_or(error!(SssError::Overflow))?;

    config.admin_op_kind = op_kind;
    config.admin_op_param = param;
    config.admin_op_target = target;
    config.admin_op_mature_slot = mature_slot;

    msg!(
        "TimelockOp proposed: kind={} param={} target={} mature_at_slot={} delay={} effective_delay={}",
        op_kind,
        param,
        target,
        mature_slot,
        delay,
        effective_delay,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// execute_timelocked_op
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExecuteTimelockOp<'info> {
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

    pub token_program: Interface<'info, TokenInterface>,
}

/// Execute the pending timelocked admin operation once the timelock has matured.
pub fn execute_timelocked_op_handler(ctx: Context<ExecuteTimelockOp>) -> Result<()> {
    // AUDIT NOTE: Squads enforcement — defense-in-depth verify_squads_signer check.
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;
    let op_kind = config.admin_op_kind;

    require!(op_kind != ADMIN_OP_NONE, SssError::NoTimelockPending);

    let clock = Clock::get()?;
    require!(
        clock.slot >= config.admin_op_mature_slot,
        SssError::TimelockNotMature
    );

    let param = config.admin_op_param;
    let target = config.admin_op_target;

    match op_kind {
        // --- Original 3 ops ---
        ADMIN_OP_TRANSFER_AUTHORITY => {
            require!(target != Pubkey::default(), SssError::NoTimelockPending);
            config.pending_authority = target;
            msg!("Timelock: authority transfer staged to {}", target);
        }
        ADMIN_OP_SET_FEATURE_FLAG => {
            config.feature_flags |= param;
            msg!(
                "Timelock: SET feature_flags 0x{:016x} -> 0x{:016x}",
                param,
                config.feature_flags
            );
        }
        ADMIN_OP_CLEAR_FEATURE_FLAG => {
            // BUG-011: FLAG_DAO_COMMITTEE cannot be cleared via timelock admin op.
            // Removing the DAO committee guard requires an explicit DAO governance vote.
            require!(
                param & crate::state::FLAG_DAO_COMMITTEE == 0,
                SssError::DaoFlagProtected
            );
            // AUDIT3C: FLAG_SQUADS_AUTHORITY cannot be cleared via timelock admin op.
            // Downgrading from multisig to single-signer requires explicit governance.
            require!(
                param & crate::state::FLAG_SQUADS_AUTHORITY == 0,
                SssError::DaoFlagProtected
            );
            config.feature_flags &= !param;
            msg!(
                "Timelock: CLEAR feature_flags mask=0x{:016x} -> 0x{:016x}",
                param,
                config.feature_flags
            );
        }

        // --- BUG-010: New timelocked ops ---

        ADMIN_OP_SET_PYTH_FEED => {
            // target = new feed pubkey; param unused
            config.expected_pyth_feed = target;
            // Also update oracle_feed for oracle abstraction layer (SSS-119)
            if config.oracle_type == 0 {
                config.oracle_feed = target;
            }
            msg!("Timelock: expected_pyth_feed set to {}", target);
        }
        ADMIN_OP_SET_ORACLE_PARAMS => {
            // param = (max_age_secs as u64) << 16 | (max_conf_bps as u64)
            let max_age_secs = (param >> 16) as u32;
            let max_conf_bps = (param & 0xFFFF) as u16;
            config.max_oracle_age_secs = max_age_secs;
            config.max_oracle_conf_bps = max_conf_bps;
            msg!(
                "Timelock: oracle params — max_age_secs={} max_conf_bps={}",
                max_age_secs,
                max_conf_bps
            );
        }
        ADMIN_OP_SET_STABILITY_FEE => {
            // param = fee_bps as u64 (max 10_000 = 100% p.a.)
            require!(param <= 10_000, SssError::InvalidStabilityFee);
            config.stability_fee_bps = param as u16;
            msg!("Timelock: stability_fee_bps set to {}", param);
        }
        ADMIN_OP_SET_PSM_FEE => {
            // param = fee_bps as u64 (max 1_000 = 10%)
            require!(param <= 1_000, SssError::InvalidPsmFee);
            config.redemption_fee_bps = param as u16;
            msg!("Timelock: redemption_fee_bps (PSM fee) set to {}", param);
        }
        ADMIN_OP_SET_BACKSTOP_PARAMS => {
            // target = insurance_fund_pubkey, param = max_backstop_bps
            require!(param <= 10_000, SssError::InvalidBackstopParams);
            config.insurance_fund_pubkey = target;
            config.max_backstop_bps = param as u16;
            msg!(
                "Timelock: backstop params — vault={} max_backstop_bps={}",
                target,
                param
            );
        }
        ADMIN_OP_SET_SPEND_LIMIT => {
            // param = max_transfer_amount (0 = unlimited)
            config.max_transfer_amount = param;
            msg!("Timelock: max_transfer_amount set to {}", param);
        }
        ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY => {
            // target = new compliance authority pubkey
            require!(target != Pubkey::default(), SssError::Unauthorized);
            config.pending_compliance_authority = target;
            msg!("Timelock: compliance authority transfer staged to {}", target);
        }
        ADMIN_OP_SET_ORACLE_CONFIG => {
            // param = oracle_type (0=Pyth, 1=Switchboard, 2=Custom), target = oracle_feed
            let oracle_type = param as u8;
            require!(oracle_type <= 2, SssError::InvalidOracleType);
            config.oracle_type = oracle_type;
            config.oracle_feed = target;
            msg!(
                "Timelock: oracle_config — type={} feed={}",
                oracle_type,
                target
            );
        }
        ADMIN_OP_SET_MIN_RESERVE_RATIO => {
            // param = min_reserve_ratio_bps (0 to 20_000 for up to 200%)
            require!(param <= 20_000, SssError::InvalidReserveRatio);
            config.min_reserve_ratio_bps = param as u16;
            msg!("Timelock: min_reserve_ratio_bps set to {}", param);
        }
        ADMIN_OP_SET_TRAVEL_RULE_THRESHOLD => {
            // param = travel_rule_threshold in token native units
            config.travel_rule_threshold = param;
            msg!("Timelock: travel_rule_threshold set to {}", param);
        }
        ADMIN_OP_SET_SANCTIONS_PARAMS => {
            // target = sanctions oracle pubkey, param = max_staleness_slots
            config.sanctions_oracle = target;
            config.sanctions_max_staleness_slots = param;
            msg!(
                "Timelock: sanctions_oracle={} staleness_slots={}",
                target,
                param
            );
        }
        ADMIN_OP_SET_TIMELOCK_DELAY => {
            // param = new delay in slots; enforce minimum 1 epoch (216_000 slots)
            // to prevent the authority from instantly reducing its own timelock.
            require!(param >= 216_000, SssError::InvalidTimelockDelay);
            config.admin_timelock_delay = param;
            msg!("Timelock: admin_timelock_delay updated to {} slots", param);
        }
        ADMIN_OP_PAUSE => {
            config.paused = true;
            msg!("Timelock: protocol PAUSED");
        }
        ADMIN_OP_UNPAUSE => {
            // Unpause via admin timelock is disabled to prevent bypassing
            // the guardian 24h pause override (BUG-018 / SSS-121).
            // Use the `pause` instruction (direct) or `guardian_lift_pause` instead.
            return err!(SssError::InstructionDisabled);
        }

        _ => return err!(SssError::InvalidTimelockOpKind),
    }

    // Clear pending op
    config.admin_op_kind = ADMIN_OP_NONE;
    config.admin_op_param = 0;
    config.admin_op_target = Pubkey::default();
    config.admin_op_mature_slot = 0;

    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_timelocked_op
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelTimelockOp<'info> {
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

    pub token_program: Interface<'info, TokenInterface>,
}

/// Cancel the pending timelocked admin operation.  No-op if none is pending.
pub fn cancel_timelocked_op_handler(ctx: Context<CancelTimelockOp>) -> Result<()> {
    // AUDIT NOTE: Squads enforcement — defense-in-depth verify_squads_signer check.
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let config = &mut ctx.accounts.config;
    let op_kind = config.admin_op_kind;
    require!(op_kind != ADMIN_OP_NONE, SssError::NoTimelockPending);

    config.admin_op_kind = ADMIN_OP_NONE;
    config.admin_op_param = 0;
    config.admin_op_target = Pubkey::default();
    config.admin_op_mature_slot = 0;

    msg!("TimelockOp cancelled (was kind={})", op_kind);
    Ok(())
}

// ---------------------------------------------------------------------------
// set_pyth_feed  (legacy direct-call — blocked when timelock > 0)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetPythFeed<'info> {
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

    pub token_program: Interface<'info, TokenInterface>,
}

/// Register the expected Pyth price feed for this SSS-3 stablecoin.
///
/// BUG-010: When `admin_timelock_delay > 0` this direct call is blocked.
/// Use `propose_timelocked_op` (op_kind=4) + `execute_timelocked_op` instead.
pub fn set_pyth_feed_handler(ctx: Context<SetPythFeed>, feed: Pubkey) -> Result<()> {
    require_timelock_executed(&ctx.accounts.config, ADMIN_OP_SET_PYTH_FEED)?;
    let config = &mut ctx.accounts.config;
    config.expected_pyth_feed = feed;
    msg!("expected_pyth_feed set to {} (no-timelock path)", feed);
    Ok(())
}

// ---------------------------------------------------------------------------
// set_oracle_params  (legacy direct-call — blocked when timelock > 0)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetOracleParams<'info> {
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

    pub token_program: Interface<'info, TokenInterface>,
}

/// Configure oracle staleness and confidence parameters for CDP operations.
///
/// BUG-010: When `admin_timelock_delay > 0` this direct call is blocked.
/// Use `propose_timelocked_op` (op_kind=5, param=(max_age_secs<<16|max_conf_bps))
/// + `execute_timelocked_op` instead.
pub fn set_oracle_params_handler(
    ctx: Context<SetOracleParams>,
    max_age_secs: u32,
    max_conf_bps: u16,
) -> Result<()> {
    require_timelock_executed(&ctx.accounts.config, ADMIN_OP_SET_ORACLE_PARAMS)?;
    let config = &mut ctx.accounts.config;
    config.max_oracle_age_secs = max_age_secs;
    config.max_oracle_conf_bps = max_conf_bps;
    msg!(
        "SSS-090: oracle params updated (no-timelock path) — max_age_secs={}, max_conf_bps={}",
        max_age_secs,
        max_conf_bps,
    );
    Ok(())
}
