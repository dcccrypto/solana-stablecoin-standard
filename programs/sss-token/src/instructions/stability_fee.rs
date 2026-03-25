use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, Burn, Mint, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::state::{CdpPosition, StablecoinConfig};

/// Max stability fee: 20% per annum (2000 bps)
pub const MAX_STABILITY_FEE_BPS: u16 = 2000;

/// Seconds per year (non-leap).
const SECS_PER_YEAR: u64 = 365 * 24 * 3600;

// ─── CollectStabilityFee (keeper-authorized) ─────────────────────────────────

/// Accrue and collect stability fees for a CDP position.
///
/// BUG-015 FIX: Keepers can now collect fees without the debtor's signature.
/// The `caller` account must be either:
///   1. The stablecoin `config.authority`, OR
///   2. A pubkey listed in `config.authorized_keepers`
///
/// Previously this required `debtor` to sign, making keeper automation
/// impossible and fee collection entirely voluntary on the debtor's part.
///
/// Fee calculation (simple interest, not compound):
///   fee = debt_amount * stability_fee_bps * elapsed_secs / (10_000 * SECS_PER_YEAR)
///
/// The fee is burned from the debtor's SSS token account, reducing net supply
/// (the canonical "burned" counter is updated on `StablecoinConfig`).
/// If `stability_fee_bps == 0` on the config the instruction is a no-op
/// (returns `Ok(())` without burning anything).
///
/// BUG-016 FIX: `accrued_fees` is NOT incremented on collection — the fee has
/// already been burned from the debtor's balance.  Previously `accrued_fees`
/// was also incremented, double-counting the collected amount in
/// `cdp_position.accrued_fees`.
#[derive(Accounts)]
pub struct CollectStabilityFee<'info> {
    /// BUG-015: caller can be authority OR a whitelisted keeper — NOT the debtor.
    /// The debtor no longer needs to sign; keepers may call this permissionlessly
    /// as long as they appear in `config.authorized_keepers` (or are the authority).
    #[account(mut)]
    pub caller: Signer<'info>,

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

    /// CDP position to accrue fees on — keyed by [SEED, mint, debtor_pubkey].
    /// The `debtor` CHECK account (read-only, no signature required) is used
    /// only to derive the PDA seeds.
    /// CHECK: used only as a seed for the CDP PDA derivation; no funds held.
    pub debtor: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), debtor.key().as_ref()],
        bump = cdp_position.bump,
    )]
    pub cdp_position: Account<'info, CdpPosition>,

    /// Debtor's SSS token account — fees are burned from here.
    #[account(
        mut,
        constraint = debtor_sss_account.mint == sss_mint.key(),
        constraint = debtor_sss_account.owner == debtor.key(),
    )]
    pub debtor_sss_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn collect_stability_fee_handler(ctx: Context<CollectStabilityFee>) -> Result<()> {
    // BUG-015: caller must be config authority OR a whitelisted keeper.
    let caller_key = ctx.accounts.caller.key();
    let config = &ctx.accounts.config;
    let is_authority = caller_key == config.authority;
    let is_keeper = config
        .authorized_keepers
        .iter()
        .any(|k| *k == caller_key && *k != Pubkey::default());

    require!(
        is_authority || is_keeper,
        SssError::Unauthorized
    );

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

    // Burn fee from debtor's account.
    // The token_program holds a delegate authority over the debtor's token account
    // when the CDP was opened — the config PDA signs via seeds.
    let sss_mint_key = ctx.accounts.sss_mint.key();
    let seeds: &[&[u8]] = &[
        StablecoinConfig::SEED,
        sss_mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ];
    let signer_seeds = &[seeds];

    burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.debtor_sss_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        fee_amount,
    )?;

    // BUG-016 FIX: Do NOT increment accrued_fees — the fee has been burned.
    // Only update last_fee_accrual timestamp and total_burned on config.
    // (Previously accrued_fees was incorrectly incremented here, double-counting
    // fees that had already left the debtor's balance via burn.)
    ctx.accounts.cdp_position.last_fee_accrual = now;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(fee_amount).unwrap();

    msg!(
        "SSS-092/BUG-015-016 stability fee: burned {} SSS from {}. elapsed={}s fee_bps={} caller={}",
        fee_amount,
        ctx.accounts.debtor.key(),
        elapsed_secs,
        fee_bps,
        caller_key,
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

// ─── AddAuthorizedKeeper / RemoveAuthorizedKeeper ─────────────────────────────

/// BUG-015: Authority-only instruction to add a keeper pubkey to the whitelist.
/// Keepers are allowed to call `collect_stability_fee` on any CDP without
/// requiring the debtor's signature.
#[derive(Accounts)]
pub struct AddAuthorizedKeeper<'info> {
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

pub fn add_authorized_keeper_handler(
    ctx: Context<AddAuthorizedKeeper>,
    keeper: Pubkey,
) -> Result<()> {
    require!(keeper != Pubkey::default(), SssError::Unauthorized);

    // Idempotent: don't add duplicates
    if ctx.accounts.config.authorized_keepers.contains(&keeper) {
        return Ok(());
    }

    // Find empty slot
    let slot = ctx
        .accounts
        .config
        .authorized_keepers
        .iter_mut()
        .find(|k| **k == Pubkey::default());

    match slot {
        Some(s) => {
            *s = keeper;
            msg!("BUG-015: added authorized keeper {}", keeper);
            Ok(())
        }
        None => err!(SssError::WhitelistFull),
    }
}

/// BUG-015: Authority-only instruction to remove a keeper from the whitelist.
#[derive(Accounts)]
pub struct RemoveAuthorizedKeeper<'info> {
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

pub fn remove_authorized_keeper_handler(
    ctx: Context<RemoveAuthorizedKeeper>,
    keeper: Pubkey,
) -> Result<()> {
    let slot = ctx
        .accounts
        .config
        .authorized_keepers
        .iter_mut()
        .find(|k| **k == keeper);

    match slot {
        Some(s) => {
            *s = Pubkey::default();
            msg!("BUG-015: removed authorized keeper {}", keeper);
            Ok(())
        }
        None => err!(SssError::MemberNotFound),
    }
}
