use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::SssError;
use crate::oracle;
use crate::state::{CdpPosition, CollateralVault, StablecoinConfig};

// ─── Events ──────────────────────────────────────────────────────────────────

/// Emitted when a bad-debt backstop draw occurs.
#[event]
pub struct BadDebtTriggered {
    /// The SSS stablecoin mint this backstop covers.
    pub sss_mint: Pubkey,
    /// Amount of collateral transferred from the insurance fund (native token units).
    pub backstop_amount: u64,
    /// Computed on-chain shortfall (debt − collateral value, in SSS native units).
    pub computed_shortfall: u64,
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
///
/// BUG-010: When `admin_timelock_delay > 0` this direct call is blocked.
/// Use `propose_timelocked_op` (op_kind=8, target=vault, param=max_bps) + execute.
pub fn set_backstop_params_handler(
    ctx: Context<SetBackstopParams>,
    insurance_fund_pubkey: Pubkey,
    max_backstop_bps: u16,
) -> Result<()> {
    // BUG-010: block direct call when timelock is active.
    crate::instructions::admin_timelock::require_timelock_executed(
        &ctx.accounts.config,
        crate::state::ADMIN_OP_SET_BACKSTOP_PARAMS,
    )?;

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

/// Called by the liquidation handler after a liquidation leaves collateral < debt.
/// Draws up to `max_backstop_bps` of outstanding debt from the insurance fund
/// to cover the shortfall.  Emits `BadDebtTriggered`.
///
/// # BUG-031 Fix: on-chain shortfall computation
///
/// The shortfall is now computed entirely from on-chain state:
///   shortfall = cdp_position.debt_amount − collateral_value_in_sss_units
///
/// where collateral_value_in_sss_units is derived from the oracle price:
///   collateral_value = deposited_amount * oracle_price / 10^(coll_decimals + expo_abs - sss_decimals)
///
/// If collateral_value >= debt the position is no longer under-water and the
/// instruction reverts with `NoBadDebt`.  This prevents any caller from inflating
/// the shortfall to drain more from the insurance fund than the actual deficit.
///
/// Access control: only the CDP liquidation PDA (`cdp_liquidate` signer) may call
/// this.  In practice this means the instruction must be invoked *by the caller of
/// `cdp_liquidate`* in the same transaction, with the config PDA as the signer
/// authority.  We enforce this by requiring `liquidation_authority` == `config` key,
/// which only the on-chain `cdp_liquidate` handler can supply.
#[derive(Accounts)]
#[instruction(cdp_owner: Pubkey)]
pub struct TriggerBackstop<'info> {
    /// Must be the config PDA — enforces that only the liquidation handler (which
    /// holds a mutable borrow of config) can invoke trigger_backstop via CPI.
    pub liquidation_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
        // Only the config PDA itself is authorised to trigger the backstop.
        constraint = liquidation_authority.key() == config.key() @ SssError::UnauthorizedBackstopCaller,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// SSS stablecoin mint — used for decimal scaling.
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// CDP position of the borrower whose bad debt is being covered.
    /// Seeds: [b"cdp-position", sss_mint, cdp_owner]
    #[account(
        seeds = [CdpPosition::SEED, sss_mint.key().as_ref(), cdp_owner.as_ref()],
        bump = cdp_position.bump,
        constraint = cdp_position.sss_mint == sss_mint.key() @ SssError::Unauthorized,
        constraint = cdp_position.collateral_mint == collateral_mint.key() @ SssError::WrongCollateralMint,
    )]
    pub cdp_position: Box<Account<'info, CdpPosition>>,

    /// Collateral vault for this CDP — used to read remaining deposited_amount.
    /// Seeds: [b"cdp-collateral-vault", sss_mint, cdp_owner, collateral_mint]
    #[account(
        seeds = [
            CollateralVault::SEED,
            sss_mint.key().as_ref(),
            cdp_owner.as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump = collateral_vault.bump,
        constraint = collateral_vault.owner == cdp_owner @ SssError::Unauthorized,
        constraint = collateral_vault.collateral_mint == collateral_mint.key() @ SssError::WrongCollateralMint,
    )]
    pub collateral_vault: Box<Account<'info, CollateralVault>>,

    /// The collateral token mint — used for decimal scaling.
    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::WrongCollateralMint,
    )]
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Oracle price feed account — validated by oracle::get_oracle_price via config.
    /// CHECK: validated via config.oracle_feed / config.expected_pyth_feed inside oracle module.
    pub oracle_price_feed: AccountInfo<'info>,

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

    /// Insurance fund authority — must sign to allow transfer from insurance fund.
    pub insurance_fund_authority: Signer<'info>,

    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn trigger_backstop_handler(
    ctx: Context<TriggerBackstop>,
    _cdp_owner: Pubkey,
) -> Result<()> {
    let config = &ctx.accounts.config;

    // Backstop must be configured.
    require!(
        config.insurance_fund_pubkey != Pubkey::default(),
        SssError::BackstopNotConfigured
    );

    // ── BUG-031: Compute shortfall entirely on-chain ──────────────────────────
    //
    // shortfall (in SSS native units) = debt_amount − floor(collateral_value / oracle_price)
    //
    // collateral_value_in_sss = deposited_collateral * oracle_price * 10^sss_decimals
    //                           / (10^coll_decimals * 10^price_expo_abs)
    //
    // If collateral_value_in_sss >= debt_amount → no bad debt → revert.

    let clock = Clock::get()?;

    // Use the base oracle price (no multi-oracle consensus for backstop CPI path).
    // The oracle validity was already checked by cdp_liquidate in the same transaction.
    let oracle_price = oracle::get_oracle_price(
        &ctx.accounts.oracle_price_feed,
        config,
        &clock,
    )?;

    let deposited = ctx.accounts.collateral_vault.deposited_amount;
    let debt = ctx.accounts.cdp_position.debt_amount;
    let accrued_fees = ctx.accounts.cdp_position.accrued_fees;
    let effective_debt = debt.checked_add(accrued_fees).ok_or(error!(SssError::Overflow))?;

    let collateral_decimals = ctx.accounts.collateral_mint.decimals as u32;
    let sss_decimals = ctx.accounts.sss_mint.decimals as u32;
    let price_val = oracle_price.price as u128;
    let price_expo_abs = oracle_price.expo.unsigned_abs();

    // collateral_value_in_sss_native (same units as debt_amount):
    //   = deposited * price_val * 10^sss_decimals
    //     / (10^coll_decimals * 10^price_expo_abs)
    //
    // We compute in u128 to avoid overflow.
    let collateral_value_in_sss: u128 = (deposited as u128)
        .checked_mul(price_val)
        .ok_or(error!(SssError::InvalidPrice))?
        .checked_mul(10u128.pow(sss_decimals))
        .ok_or(error!(SssError::InvalidPrice))?
        / 10u128.pow(collateral_decimals)
        / 10u128.pow(price_expo_abs);

    // If collateral covers the full debt → no bad debt.
    require!(
        (effective_debt as u128) > collateral_value_in_sss,
        SssError::NoBadDebt
    );

    let shortfall_amount = ((effective_debt as u128).saturating_sub(collateral_value_in_sss)).min(u64::MAX as u128) as u64;

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
        computed_shortfall: shortfall_amount,
        remaining_shortfall,
        net_supply,
    });

    msg!(
        "BadDebt backstop triggered (on-chain shortfall={}): drew {} collateral from insurance fund; remaining shortfall={}; net_supply={}",
        shortfall_amount,
        backstop_amount,
        remaining_shortfall,
        net_supply,
    );

    Ok(())
}
