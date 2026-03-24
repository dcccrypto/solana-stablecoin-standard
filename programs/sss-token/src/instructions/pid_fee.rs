use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::events::{PidConfigInitialised, PidFeeUpdated};
use crate::state::{PidConfig, StablecoinConfig, FLAG_PID_FEE_CONTROL};

// ---------------------------------------------------------------------------
// SSS-130: Stability Fee PID Auto-Adjustment
// ---------------------------------------------------------------------------
//
// Replaces manual `set_stability_fee` with a PID controller that adjusts
// `stability_fee_bps` based on peg deviation from `target_price`.
//
// PID formula (all i64, scaled by 1_000_000):
//   error       = (target_price as i64) - (current_price as i64)
//   integral   += error
//   derivative  = error - last_error
//   raw_output  = kp*error + ki*integral + kd*derivative   (all in 1e6 units)
//   delta_bps   = raw_output / 1_000_000
//   new_fee_bps = clamp(current_fee_bps + delta_bps, min_fee_bps, max_fee_bps)
//
// `current_price` is passed by the caller (keeper / anyone) in oracle units
// (same denomination as `target_price`).  The program does not verify the
// oracle account on-chain — in production, callers should read from the
// configured Pyth feed.  An optional `oracle_hint` field can be stored in
// `PidConfig` for transparency.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// init_pid_config — authority-only setup
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitPidConfigParams {
    /// Proportional gain (scaled by 1_000_000; e.g. 0.001 → 1_000)
    pub kp: i64,
    /// Integral gain (scaled by 1_000_000)
    pub ki: i64,
    /// Derivative gain (scaled by 1_000_000)
    pub kd: i64,
    /// Target peg price in oracle units (e.g. 1_000_000 for $1.00 with 6 dec)
    pub target_price: u64,
    /// Minimum stability fee in bps (floor)
    pub min_fee_bps: u16,
    /// Maximum stability fee in bps (ceiling)
    pub max_fee_bps: u16,
}

#[derive(Accounts)]
pub struct InitPidConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + PidConfig::INIT_SPACE,
        seeds = [PidConfig::SEED, config.mint.as_ref()],
        bump,
    )]
    pub pid_config: Account<'info, PidConfig>,

    pub system_program: Program<'info, System>,
}

pub fn init_pid_config_handler(
    ctx: Context<InitPidConfig>,
    params: InitPidConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        params.min_fee_bps <= params.max_fee_bps,
        SssError::InvalidPidFeeRange,
    );

    let config = &mut ctx.accounts.config;
    let pid = &mut ctx.accounts.pid_config;

    pid.sss_mint = config.mint;
    pid.kp = params.kp;
    pid.ki = params.ki;
    pid.kd = params.kd;
    pid.target_price = params.target_price;
    pid.min_fee_bps = params.min_fee_bps;
    pid.max_fee_bps = params.max_fee_bps;
    pid.last_error = 0;
    pid.integral = 0;
    pid.last_update_slot = Clock::get()?.slot;
    pid.bump = ctx.bumps.pid_config;

    // Enable the feature flag.
    config.feature_flags |= FLAG_PID_FEE_CONTROL;

    emit!(PidConfigInitialised {
        mint: config.mint,
        kp: params.kp,
        ki: params.ki,
        kd: params.kd,
        target_price: params.target_price,
        min_fee_bps: params.min_fee_bps,
        max_fee_bps: params.max_fee_bps,
    });

    msg!(
        "PidConfig initialised: mint={} kp={} ki={} kd={} target={} min_bps={} max_bps={}",
        config.mint,
        params.kp,
        params.ki,
        params.kd,
        params.target_price,
        params.min_fee_bps,
        params.max_fee_bps,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// update_stability_fee_pid — permissionless keeper call
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdateStabilityFeePid<'info> {
    /// Permissionless — any keeper may call this.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [PidConfig::SEED, config.mint.as_ref()],
        bump = pid_config.bump,
    )]
    pub pid_config: Account<'info, PidConfig>,
}

pub fn update_stability_fee_pid_handler(
    ctx: Context<UpdateStabilityFeePid>,
    current_price: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pid = &mut ctx.accounts.pid_config;

    require!(
        config.check_feature_flag(FLAG_PID_FEE_CONTROL),
        SssError::PidConfigNotFound,
    );

    // PID computation (i64 arithmetic, 1e6-scaled gains)
    let error: i64 = (pid.target_price as i64).saturating_sub(current_price as i64);

    // Anti-windup: clamp integral to ±1_000_000_000 to prevent runaway
    let new_integral = pid
        .integral
        .saturating_add(error)
        .clamp(-1_000_000_000, 1_000_000_000);

    let derivative: i64 = error.saturating_sub(pid.last_error);

    // raw_output in 1e6 units
    let raw_output: i64 = pid
        .kp
        .saturating_mul(error)
        .saturating_add(pid.ki.saturating_mul(new_integral))
        .saturating_add(pid.kd.saturating_mul(derivative));

    // Scale down to bps delta
    let delta_bps: i64 = raw_output / 1_000_000;

    // Apply delta to current fee, clamp to [min, max]
    let current_bps = config.stability_fee_bps as i64;
    let new_bps_unclamped = current_bps.saturating_add(delta_bps);
    let new_bps = new_bps_unclamped.clamp(
        pid.min_fee_bps as i64,
        pid.max_fee_bps as i64,
    ) as u16;

    let old_fee = config.stability_fee_bps;
    config.stability_fee_bps = new_bps;

    // Update PID state
    pid.last_error = error;
    pid.integral = new_integral;
    pid.last_update_slot = Clock::get()?.slot;

    emit!(PidFeeUpdated {
        mint: config.mint,
        old_fee_bps: old_fee,
        new_fee_bps: new_bps,
        current_price,
        target_price: pid.target_price,
        error,
        integral: new_integral,
        derivative,
        delta_bps,
    });

    msg!(
        "PID fee updated: mint={} old_bps={} new_bps={} price={} target={} err={} delta={}",
        config.mint,
        old_fee,
        new_bps,
        current_price,
        pid.target_price,
        error,
        delta_bps,
    );
    Ok(())
}
