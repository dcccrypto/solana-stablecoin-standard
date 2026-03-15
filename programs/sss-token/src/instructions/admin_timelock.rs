//! SSS-085 Fix 2 — Admin Timelock
//!
//! Critical single-authority admin operations (authority transfer, feature flag
//! changes) are delayed by a minimum of `config.admin_timelock_delay` slots
//! (default 432 000 slots ≈ 2 Solana epochs / ~2 days).
//!
//! Lifecycle:
//!  1. Authority calls `propose_timelocked_op` — stores op + mature slot.
//!  2. After `admin_op_mature_slot` is reached, authority calls `execute_timelocked_op`.
//!  3. Authority may call `cancel_timelocked_op` at any time before execution.
//!
//! This prevents a compromised key from instantly draining the protocol.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::state::{
    StablecoinConfig, ADMIN_OP_CLEAR_FEATURE_FLAG, ADMIN_OP_NONE, ADMIN_OP_SET_FEATURE_FLAG,
    ADMIN_OP_TRANSFER_AUTHORITY,
};

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
/// - `op_kind`: one of ADMIN_OP_TRANSFER_AUTHORITY (1), ADMIN_OP_SET_FEATURE_FLAG (2),
///   ADMIN_OP_CLEAR_FEATURE_FLAG (3).
/// - `param`: flag bits for Set/ClearFeatureFlag; 0 for authority transfer.
/// - `target`: new authority pubkey for ADMIN_OP_TRANSFER_AUTHORITY; Pubkey::default otherwise.
///
/// Overwrites any existing pending op (only one pending op at a time).
pub fn propose_timelocked_op_handler(
    ctx: Context<ProposeTimelockOp>,
    op_kind: u8,
    param: u64,
    target: Pubkey,
) -> Result<()> {
    require!(
        op_kind == ADMIN_OP_TRANSFER_AUTHORITY
            || op_kind == ADMIN_OP_SET_FEATURE_FLAG
            || op_kind == ADMIN_OP_CLEAR_FEATURE_FLAG,
        SssError::NoTimelockPending // re-used as "invalid op kind"
    );

    let clock = Clock::get()?;
    let config = &mut ctx.accounts.config;
    let mature_slot = clock
        .slot
        .checked_add(config.admin_timelock_delay)
        .unwrap();

    config.admin_op_kind = op_kind;
    config.admin_op_param = param;
    config.admin_op_target = target;
    config.admin_op_mature_slot = mature_slot;

    msg!(
        "TimelockOp proposed: kind={} param={} target={} mature_at_slot={}",
        op_kind,
        param,
        target,
        mature_slot,
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
    let config = &mut ctx.accounts.config;
    let op_kind = config.admin_op_kind;

    require!(op_kind != ADMIN_OP_NONE, SssError::NoTimelockPending);

    let clock = Clock::get()?;
    require!(
        clock.slot >= config.admin_op_mature_slot,
        SssError::TimelockNotMature
    );

    match op_kind {
        ADMIN_OP_TRANSFER_AUTHORITY => {
            let new_auth = config.admin_op_target;
            require!(new_auth != Pubkey::default(), SssError::NoTimelockPending);
            config.pending_authority = new_auth;
            msg!("Timelock: authority transfer staged to {}", new_auth);
        }
        ADMIN_OP_SET_FEATURE_FLAG => {
            config.feature_flags |= config.admin_op_param;
            msg!(
                "Timelock: SET feature_flags 0x{:016x} -> 0x{:016x}",
                config.admin_op_param,
                config.feature_flags
            );
        }
        ADMIN_OP_CLEAR_FEATURE_FLAG => {
            config.feature_flags &= !config.admin_op_param;
            msg!(
                "Timelock: CLEAR feature_flags mask=0x{:016x} -> 0x{:016x}",
                config.admin_op_param,
                config.feature_flags
            );
        }
        _ => return err!(SssError::NoTimelockPending),
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
// set_pyth_feed  (SSS-085 Fix 1 helper)
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
/// After setting, `cdp_borrow_stable` and `cdp_liquidate` will reject any
/// price feed account that does not match this key.
pub fn set_pyth_feed_handler(ctx: Context<SetPythFeed>, feed: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.expected_pyth_feed = feed;
    msg!("expected_pyth_feed set to {}", feed);
    Ok(())
}
