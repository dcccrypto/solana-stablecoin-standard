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
/// Anyone may call this — it is incentive-compatible for keepers to call it
/// periodically because accrued fees increase the effective debt, nudging
/// undercollateralised positions toward liquidation.
///
/// Fee calculation (simple interest, not compound):
///   fee = debt_amount * stability_fee_bps * elapsed_secs / (10_000 * SECS_PER_YEAR)
///
/// The fee is burned from the debtor's SSS token account, reducing net supply
/// (the canonical "burned" counter is updated on `StablecoinConfig`).
/// If `stability_fee_bps == 0` on the config the instruction is a no-op
/// (returns `Ok(())` without burning anything).
#[derive(Accounts)]
pub struct CollectStabilityFee<'info> {
    /// The CDP position owner (must sign — they authorise the burn from their account)
    #[account(mut)]
    pub debtor: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

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
    #[account(
        mut,
        constraint = debtor_sss_account.mint == sss_mint.key(),
        constraint = debtor_sss_account.owner == debtor.key(),
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
    let fee_amount = debt
        .checked_mul(fee_bps as u128)
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(elapsed_secs as u128)
        .ok_or(error!(SssError::InvalidPrice))?
        / (10_000u128 * SECS_PER_YEAR as u128);

    let fee_amount = fee_amount as u64;

    if fee_amount == 0 {
        // Update timestamp even if rounded down to zero (avoids re-processing same second)
        ctx.accounts.cdp_position.last_fee_accrual = now;
        return Ok(());
    }

    // Burn fee from debtor's account
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.debtor_sss_account.to_account_info(),
                authority: ctx.accounts.debtor.to_account_info(),
            },
        ),
        fee_amount,
    )?;

    // Update state
    ctx.accounts.cdp_position.accrued_fees = ctx
        .accounts
        .cdp_position
        .accrued_fees
        .checked_add(fee_amount)
        .unwrap();
    ctx.accounts.cdp_position.last_fee_accrual = now;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(fee_amount).unwrap();

    msg!(
        "SSS-092 stability fee: burned {} SSS from {}. elapsed={}s fee_bps={}",
        fee_amount,
        ctx.accounts.debtor.key(),
        elapsed_secs,
        fee_bps,
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
    pub config: Box<Account<'info, StablecoinConfig>>,
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
