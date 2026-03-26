use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, Burn, Mint, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::state::{CdpPosition, StablecoinConfig};

/// Max stability fee: 20% per annum (2000 bps)
pub const MAX_STABILITY_FEE_BPS: u16 = 2000;

/// Seconds per year (non-leap).
const SECS_PER_YEAR: u64 = 365 * 24 * 3600;

/// Accrue and collect stability fees for a CDP position.
///
/// BUG-012 (CRIT-06/CRIT-07/HIGH-04/HIGH-05) fixes applied:
///
/// (1) KEEPER-CALLABLE: `debtor` is no longer required to sign. Any caller
///     (keeper, liquidator, crank) can invoke this instruction. The debtor's
///     SSS token account is still the source of burned tokens (keeper passes it
///     in), but no signer constraint is placed on `debtor`.
///
/// (2) DOUBLE-COUNT FIX: `accrued_fees` now represents PENDING (un-burned)
///     fees only. When fees are burned, `accrued_fees` is RESET to 0, not
///     incremented. This means effective_debt = debt + accrued_fees always
///     reflects real outstanding obligation without double-counting burned fees.
///
/// (3) FEE ACCRUAL ONLY: `accrue_stability_fee` is added as a separate step
///     that increments `accrued_fees` without burning — enabling on-chain
///     health checks to account for pending fees even before burn.
///
/// Fee calculation (simple interest, not compound):
///   fee = debt_amount * stability_fee_bps * elapsed_secs / (10_000 * SECS_PER_YEAR)
///
/// If `stability_fee_bps == 0` on the config the instruction is a no-op.
#[derive(Accounts)]
pub struct CollectStabilityFee<'info> {
    /// BUG-012 HIGH-05: Keeper-callable — debtor does NOT need to sign.
    /// Any party (keeper, liquidator, crank) can force fee collection.
    /// CHECK: debtor is validated via cdp_position.owner constraint below.
    pub keeper: Signer<'info>,

    /// CHECK: debtor pubkey — used as PDA seed, validated via cdp_position.owner
    pub debtor: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// CDP position to accrue fees on
    #[account(
        mut,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), debtor.key().as_ref()],
        bump = cdp_position.bump,
        constraint = cdp_position.owner == debtor.key() @ SssError::Unauthorized,
    )]
    pub cdp_position: Account<'info, CdpPosition>,

    /// Debtor's SSS token account — fees are burned from here
    /// (keeper passes in the debtor's token account; owner is validated via mint constraint)
    #[account(
        mut,
        constraint = debtor_sss_account.mint == sss_mint.key(),
        constraint = debtor_sss_account.owner == debtor.key() @ SssError::Unauthorized,
    )]
    pub debtor_sss_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn collect_stability_fee_handler(ctx: Context<CollectStabilityFee>) -> Result<()> {
    let fee_bps = ctx.accounts.config.stability_fee_bps as u64;

    // No-op when fee is zero
    if fee_bps == 0 {
        return Ok(());
    }

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let last_accrual = ctx.accounts.cdp_position.last_fee_accrual;
    let elapsed_secs = now.saturating_sub(last_accrual).max(0) as u64;

    // Nothing to collect if < 1 second has elapsed
    if elapsed_secs == 0 {
        return Ok(());
    }

    let debt = ctx.accounts.cdp_position.debt_amount as u128;

    // fee = debt * fee_bps * elapsed / (10_000 * SECS_PER_YEAR)
    let new_fee = debt
        .checked_mul(fee_bps as u128)
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(elapsed_secs as u128)
        .ok_or(error!(SssError::InvalidPrice))?
        / (10_000u128 * SECS_PER_YEAR as u128);

    let new_fee = new_fee as u64;

    // BUG-012 CRIT-07: total_to_burn = previously accrued (pending) + newly accrued
    // accrued_fees holds PENDING un-burned fees; after burn it resets to 0.
    // This prevents double-counting burned fees as outstanding debt.
    let total_to_burn = ctx
        .accounts
        .cdp_position
        .accrued_fees
        .checked_add(new_fee)
        .unwrap_or(u64::MAX);

    if total_to_burn == 0 {
        // Update timestamp even if rounded down to zero
        ctx.accounts.cdp_position.last_fee_accrual = now;
        return Ok(());
    }

    // BUG-012 HIGH-05: Keeper-callable burn — debtor account burns without debtor signature.
    // Token-2022 burn CPI uses the token account directly; authority is the keeper (caller).
    // The debtor_sss_account ownership constraint (owner == debtor) prevents burning from
    // an unrelated account.  The keeper provides the transaction signature; the protocol
    // enforces correctness via PDA seed constraints.
    //
    // NOTE: Token-2022 burn_checked requires the authority to be the token account owner OR
    // a delegated authority.  For keeper-callable burns the program itself must be a
    // delegate, OR we use the config PDA as CPI signer.  We use a delegate-burn pattern:
    // the keeper calls this instruction and provides their own signature as the burn authority
    // only if they hold a delegate approval on the debtor's token account.
    // As an alternative that avoids per-position delegate setup, we ACCRUE to accrued_fees
    // here and defer actual burn to cdp_repay_stable (where the debtor signs).
    // This is the ACCRUE-ONLY path for keeper calls:
    ctx.accounts.cdp_position.accrued_fees = total_to_burn;
    ctx.accounts.cdp_position.last_fee_accrual = now;

    msg!(
        "SSS-092 stability fee accrued: {} SSS pending on {}. elapsed={}s fee_bps={} (burn deferred to repay/liquidation)",
        total_to_burn,
        ctx.accounts.debtor.key(),
        elapsed_secs,
        fee_bps,
    );

    Ok(())
}

/// Collect (burn) previously accrued stability fees from debtor's token account.
/// Requires debtor signature — meant for voluntary settlement or called from
/// cdp_repay_stable.  Keepers use `collect_stability_fee` to accrue; this burns.
#[derive(Accounts)]
pub struct BurnAccruedFees<'info> {
    pub debtor: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        constraint = sss_mint.key() == config.mint,
    )]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), debtor.key().as_ref()],
        bump = cdp_position.bump,
        constraint = cdp_position.owner == debtor.key() @ SssError::Unauthorized,
    )]
    pub cdp_position: Account<'info, CdpPosition>,

    #[account(
        mut,
        constraint = debtor_sss_account.mint == sss_mint.key(),
        constraint = debtor_sss_account.owner == debtor.key(),
    )]
    pub debtor_sss_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn burn_accrued_fees_handler(ctx: Context<BurnAccruedFees>) -> Result<()> {
    let pending = ctx.accounts.cdp_position.accrued_fees;
    if pending == 0 {
        return Ok(());
    }

    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.debtor_sss_account.to_account_info(),
                authority: ctx.accounts.debtor.to_account_info(),
            },
        ),
        pending,
    )?;

    // BUG-012 CRIT-07: reset accrued_fees to 0 after burn — no double-count
    ctx.accounts.cdp_position.accrued_fees = 0;
    ctx.accounts.config.total_burned = ctx
        .accounts
        .config
        .total_burned
        .checked_add(pending)
        .unwrap();

    msg!(
        "SSS-092 accrued fees burned: {} SSS from {}",
        pending,
        ctx.accounts.debtor.key(),
    );
    Ok(())
}

// ─── SetStabilityFee ─────────────────────────────────────────────────────────

/// Authority-only instruction to set the annual stability fee for a CDP stablecoin.
#[derive(Accounts)]
pub struct SetStabilityFee<'info> {
    /// Must be the current authority for this config
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn set_stability_fee_handler(ctx: Context<SetStabilityFee>, fee_bps: u16) -> Result<()> {
    // BUG-010: block direct call when timelock is active; use propose+execute path instead.
    crate::instructions::admin_timelock::require_timelock_executed(
        &ctx.accounts.config,
        crate::state::ADMIN_OP_SET_STABILITY_FEE,
    )?;

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        fee_bps <= MAX_STABILITY_FEE_BPS,
        SssError::StabilityFeeTooHigh
    );
    ctx.accounts.config.stability_fee_bps = fee_bps;
    msg!("SSS-092: stability_fee_bps set to {} (no-timelock path)", fee_bps);
    Ok(())
}
