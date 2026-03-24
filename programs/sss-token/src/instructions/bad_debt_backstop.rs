use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::SssError;
use crate::state::StablecoinConfig;

// ─── Events ──────────────────────────────────────────────────────────────────

/// Emitted when a bad-debt backstop draw occurs.
#[event]
pub struct BadDebtTriggered {
    /// The SSS stablecoin mint this backstop covers.
    pub sss_mint: Pubkey,
    /// Amount of collateral transferred from the insurance fund (native token units).
    pub backstop_amount: u64,
    /// Remaining shortfall after backstop draw (0 if fully covered).
    pub remaining_shortfall: u64,
    /// Net supply (outstanding debt) at trigger time.
    pub net_supply: u64,
}

// ─── set_backstop_params ─────────────────────────────────────────────────────

/// Authority-only: configure the insurance fund and max backstop draw limit.
#[derive(Accounts)]
pub struct SetBackstopParams<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub sss_mint: InterfaceAccount<'info, Mint>,
}

/// Set or update the insurance fund pubkey and max backstop draw cap.
/// Pass `Pubkey::default()` for `insurance_fund_pubkey` to disable the backstop.
pub fn set_backstop_params_handler(
    ctx: Context<SetBackstopParams>,
    insurance_fund_pubkey: Pubkey,
    max_backstop_bps: u16,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(max_backstop_bps <= 10_000, SssError::InvalidBackstopBps);

    let config = &mut ctx.accounts.config;
    config.insurance_fund_pubkey = insurance_fund_pubkey;
    config.max_backstop_bps = max_backstop_bps;

    msg!(
        "Backstop params updated: insurance_fund={}, max_backstop_bps={}",
        insurance_fund_pubkey,
        max_backstop_bps,
    );
    Ok(())
}

// ─── trigger_backstop ────────────────────────────────────────────────────────

/// Called by the stablecoin authority (or keeper) after a liquidation leaves collateral < debt.
/// Draws up to `max_backstop_bps` of outstanding debt from the insurance fund to cover the
/// shortfall.  Emits `BadDebtTriggered`.
///
/// SSS-113 HIGH-03 Fix: The original design required the config PDA to be a signer (only
/// achievable from within a CPI), but no instruction ever invoked this via CPI, making
/// the backstop unreachable.  Changed to authority-controlled: the stablecoin authority
/// verifies the shortfall off-chain (e.g., by inspecting post-liquidation CDP state) and
/// calls this instruction manually to inject insurance funds.
///
/// The `shortfall_amount` argument is accepted from the caller; the instruction validates
/// that the backstop is configured and the insurance fund has balance, but does not
/// re-run the oracle.
#[derive(Accounts)]
pub struct TriggerBackstop<'info> {
    /// SSS-113: Must be the stablecoin authority (previously required config PDA signer
    /// which was unreachable).  Authority verifies bad debt and triggers backstop manually.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        // SSS-113: Only the registered authority may trigger the backstop.
        constraint = authority.key() == config.authority @ SssError::UnauthorizedBackstopCaller,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Insurance fund token account — source of backstop collateral.
    #[account(
        mut,
        constraint = insurance_fund.key() == config.insurance_fund_pubkey @ SssError::BackstopNotConfigured,
        constraint = insurance_fund.mint == collateral_mint.key(),
    )]
    pub insurance_fund: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Reserve vault — destination for backstop collateral (same vault used by CDP).
    #[account(
        mut,
        constraint = reserve_vault.key() == config.reserve_vault,
        constraint = reserve_vault.mint == collateral_mint.key(),
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The collateral token mint (e.g. USDC).
    #[account(
        constraint = collateral_mint.key() == config.collateral_mint,
    )]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Insurance fund authority — must sign to allow transfer from insurance fund.
    pub insurance_fund_authority: Signer<'info>,

    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn trigger_backstop_handler(
    ctx: Context<TriggerBackstop>,
    shortfall_amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.config;

    // Backstop must be configured.
    require!(
        config.insurance_fund_pubkey != Pubkey::default(),
        SssError::BackstopNotConfigured
    );

    // Shortfall must be non-zero.
    require!(shortfall_amount > 0, SssError::NoBadDebt);

    // Insurance fund must have a balance.
    let fund_balance = ctx.accounts.insurance_fund.amount;
    require!(fund_balance > 0, SssError::InsuranceFundEmpty);

    let net_supply = config.net_supply();

    // Compute maximum draw allowed (0 = unlimited).
    let max_draw = if config.max_backstop_bps == 0 {
        shortfall_amount
    } else {
        let max_by_cap = (net_supply as u128)
            .checked_mul(config.max_backstop_bps as u128)
            .unwrap_or(0)
            / 10_000u128;
        (max_by_cap as u64).min(shortfall_amount)
    };

    // Actual draw is capped by insurance fund balance.
    let backstop_amount = max_draw.min(fund_balance);
    let remaining_shortfall = shortfall_amount.saturating_sub(backstop_amount);

    // Transfer collateral from insurance fund → reserve vault.
    transfer_checked(
        CpiContext::new(
            ctx.accounts.collateral_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.insurance_fund.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.reserve_vault.to_account_info(),
                authority: ctx.accounts.insurance_fund_authority.to_account_info(),
            },
        ),
        backstop_amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    // Update total_collateral to reflect the backstop injection.
    let config_mut = &mut ctx.accounts.config;
    config_mut.total_collateral = config_mut
        .total_collateral
        .checked_add(backstop_amount)
        .ok_or(error!(SssError::InvalidPrice))?; // reuse overflow error

    emit!(BadDebtTriggered {
        sss_mint: ctx.accounts.sss_mint.key(),
        backstop_amount,
        remaining_shortfall,
        net_supply,
    });

    msg!(
        "BadDebt backstop triggered: drew {} collateral from insurance fund; remaining shortfall={}; net_supply={}",
        backstop_amount,
        remaining_shortfall,
        net_supply,
    );

    Ok(())
}
