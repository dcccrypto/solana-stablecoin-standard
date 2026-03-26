use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::{RedemptionFulfilled, RedemptionSLABreached};
use crate::state::{RedemptionGuarantee, RedemptionRequest, StablecoinConfig};

// ---------------------------------------------------------------------------
// SSS-125: On-chain redemption guarantee at par
// ---------------------------------------------------------------------------

/// Default SLA: ~3 minutes at 400ms/slot.
pub const DEFAULT_SLA_SLOTS: u64 = 450;
/// Penalty on SLA breach: 10% of redeemed amount from insurance fund.
pub const PENALTY_BPS: u64 = 1_000;
/// Approximate slots per 24h window at ~400ms/slot.
const SLOTS_PER_DAY: u64 = 216_000;

// ---------------------------------------------------------------------------
// register_redemption_pool — authority registers a reserve vault as source
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RegisterRedemptionPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// Reserve vault token account used for collateral payouts.
    /// CHECK: pubkey is stored; actual validation happens in fulfill.
    pub reserve_vault: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + RedemptionGuarantee::INIT_SPACE,
        seeds = [RedemptionGuarantee::SEED, config.mint.as_ref()],
        bump,
    )]
    pub redemption_guarantee: Box<Account<'info, RedemptionGuarantee>>,

    pub system_program: Program<'info, System>,
}

pub fn register_redemption_pool_handler(
    ctx: Context<RegisterRedemptionPool>,
    max_daily_redemption: u64,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(max_daily_redemption > 0, SssError::InvalidAmount);

    let clock = Clock::get()?;
    let rg = &mut ctx.accounts.redemption_guarantee;
    let config = &ctx.accounts.config;

    if rg.bump == 0 {
        rg.bump = ctx.bumps.redemption_guarantee;
        rg.sss_mint = config.mint;
    }

    rg.reserve_vault = ctx.accounts.reserve_vault.key();
    rg.max_daily_redemption = max_daily_redemption;
    rg.daily_redeemed = 0;
    rg.day_start_slot = clock.slot;
    rg.sla_slots = DEFAULT_SLA_SLOTS;
    rg.last_updated_slot = clock.slot;

    msg!(
        "RedemptionPool registered: mint={} vault={} max_daily={} sla_slots={}",
        config.mint,
        rg.reserve_vault,
        max_daily_redemption,
        rg.sla_slots,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// request_redemption — user locks stable tokens in escrow, creates request PDA
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct RequestRedemption<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [RedemptionGuarantee::SEED, config.mint.as_ref()],
        bump = redemption_guarantee.bump,
        constraint = redemption_guarantee.sss_mint == config.mint @ SssError::InvalidVault,
    )]
    pub redemption_guarantee: Box<Account<'info, RedemptionGuarantee>>,

    /// User's stable token account.
    #[account(
        mut,
        token::mint = config.mint,
        token::authority = user,
    )]
    pub user_stable_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Escrow: stable tokens held here until fulfilled or expired.
    /// Seeds: [b"redemption-escrow", mint] — authority = redemption_guarantee PDA.
    #[account(
        mut,
        seeds = [b"redemption-escrow", config.mint.as_ref()],
        bump,
        token::mint = config.mint,
        token::authority = redemption_guarantee,
    )]
    pub escrow_stable: Box<InterfaceAccount<'info, TokenAccount>>,

    /// One-per-(mint, user) request PDA.
    #[account(
        init,
        payer = user,
        space = 8 + RedemptionRequest::INIT_SPACE,
        seeds = [RedemptionRequest::SEED, config.mint.as_ref(), user.key().as_ref()],
        bump,
    )]
    pub redemption_request: Box<Account<'info, RedemptionRequest>>,

    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn request_redemption_handler(ctx: Context<RequestRedemption>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    let clock = Clock::get()?;
    let rg = &mut ctx.accounts.redemption_guarantee;
    let config = &ctx.accounts.config;

    // Reset daily counter if day-window has rolled over
    if clock.slot.saturating_sub(rg.day_start_slot) >= SLOTS_PER_DAY {
        rg.daily_redeemed = 0;
        rg.day_start_slot = clock.slot;
    }

    require!(
        rg.daily_redeemed.saturating_add(amount) <= rg.max_daily_redemption,
        SssError::RedemptionDailyLimitExceeded
    );

    let expiry_slot = clock.slot.saturating_add(rg.sla_slots);

    // Lock stable tokens in escrow
    let decimals = ctx.accounts.stable_mint.decimals;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_stable_ata.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.escrow_stable.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    rg.daily_redeemed = rg.daily_redeemed.saturating_add(amount);

    let rr = &mut ctx.accounts.redemption_request;
    rr.bump = ctx.bumps.redemption_request;
    rr.sss_mint = config.mint;
    rr.user = ctx.accounts.user.key();
    rr.amount = amount;
    rr.requested_slot = clock.slot;
    rr.expiry_slot = expiry_slot;
    rr.fulfilled = false;
    rr.sla_breached = false;

    msg!(
        "RedemptionRequest created: user={} amount={} expiry_slot={}",
        rr.user,
        amount,
        expiry_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// fulfill_redemption — stable in → burn_dest; reserve out → user (1:1)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FulfillRedemption<'info> {
    /// Fulfiller: authority or keeper who holds authority over the reserve vault.
    #[account(mut)]
    pub fulfiller: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        seeds = [RedemptionGuarantee::SEED, config.mint.as_ref()],
        bump = redemption_guarantee.bump,
        constraint = redemption_guarantee.sss_mint == config.mint @ SssError::InvalidVault,
    )]
    pub redemption_guarantee: Box<Account<'info, RedemptionGuarantee>>,

    #[account(
        mut,
        seeds = [RedemptionRequest::SEED, config.mint.as_ref(), redemption_request.user.as_ref()],
        bump = redemption_request.bump,
        constraint = !redemption_request.fulfilled @ SssError::RedemptionAlreadyFulfilled,
        constraint = !redemption_request.sla_breached @ SssError::RedemptionSLABreached,
    )]
    pub redemption_request: Box<Account<'info, RedemptionRequest>>,

    /// Escrow: must match PDA seeds.
    #[account(
        mut,
        seeds = [b"redemption-escrow", config.mint.as_ref()],
        bump,
        token::mint = config.mint,
        token::authority = redemption_guarantee,
    )]
    pub escrow_stable: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Reserve vault — collateral source. Must match registered vault.
    #[account(
        mut,
        constraint = reserve_vault.key() == redemption_guarantee.reserve_vault @ SssError::InvalidVault,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's collateral ATA — receives reserve payout.
    #[account(mut)]
    pub user_collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Destination for stable tokens post-fulfillment (caller burns externally).
    #[account(
        mut,
        token::mint = config.mint,
    )]
    pub burn_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn fulfill_redemption_handler(ctx: Context<FulfillRedemption>) -> Result<()> {
    let clock = Clock::get()?;
    let rr = &mut ctx.accounts.redemption_request;
    let rg = &ctx.accounts.redemption_guarantee;

    // Must be within SLA window
    require!(
        clock.slot <= rr.expiry_slot,
        SssError::RedemptionSLABreached
    );

    let amount = rr.amount;
    let stable_decimals = ctx.accounts.stable_mint.decimals;
    let collateral_decimals = ctx.accounts.collateral_mint.decimals;

    // PDA signer: redemption_guarantee owns the escrow
    let mint_key = ctx.accounts.config.mint;
    let bump = rg.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        RedemptionGuarantee::SEED,
        mint_key.as_ref(),
        &[bump],
    ]];

    // escrow → burn_destination
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.escrow_stable.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.burn_destination.to_account_info(),
                authority: ctx.accounts.redemption_guarantee.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        stable_decimals,
    )?;

    // reserve_vault → user_collateral_ata (1:1 par)
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.user_collateral_ata.to_account_info(),
                authority: ctx.accounts.fulfiller.to_account_info(),
            },
        ),
        amount,
        collateral_decimals,
    )?;

    rr.fulfilled = true;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.saturating_add(amount);

    let sla_slots_used = clock.slot.saturating_sub(rr.requested_slot);

    emit!(RedemptionFulfilled {
        mint: config.mint,
        user: rr.user,
        amount,
        requested_slot: rr.requested_slot,
        fulfilled_slot: clock.slot,
        sla_slots_used,
    });

    msg!(
        "RedemptionFulfilled: user={} amount={} sla_slots_used={}",
        rr.user,
        amount,
        sla_slots_used,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// claim_expired_redemption — SLA breached: return stable + penalty from fund
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimExpiredRedemption<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        seeds = [RedemptionGuarantee::SEED, config.mint.as_ref()],
        bump = redemption_guarantee.bump,
        constraint = redemption_guarantee.sss_mint == config.mint @ SssError::InvalidVault,
    )]
    pub redemption_guarantee: Box<Account<'info, RedemptionGuarantee>>,

    #[account(
        mut,
        seeds = [RedemptionRequest::SEED, config.mint.as_ref(), user.key().as_ref()],
        bump = redemption_request.bump,
        constraint = redemption_request.user == user.key() @ SssError::Unauthorized,
        constraint = !redemption_request.fulfilled @ SssError::RedemptionAlreadyFulfilled,
        constraint = !redemption_request.sla_breached @ SssError::RedemptionSLABreached,
    )]
    pub redemption_request: Box<Account<'info, RedemptionRequest>>,

    /// Escrow: stable tokens returned to user on breach.
    #[account(
        mut,
        seeds = [b"redemption-escrow", config.mint.as_ref()],
        bump,
        token::mint = config.mint,
        token::authority = redemption_guarantee,
    )]
    pub escrow_stable: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's stable ATA: receives stable tokens back.
    #[account(
        mut,
        token::mint = config.mint,
        token::authority = user,
    )]
    pub user_stable_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Insurance fund — pays penalty tokens to user.
    #[account(
        mut,
        constraint = insurance_fund.key() == config.insurance_fund_pubkey @ SssError::InvalidVault,
    )]
    pub insurance_fund: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User collateral ATA — receives penalty payout.
    #[account(mut)]
    pub user_collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub penalty_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_expired_redemption_handler(ctx: Context<ClaimExpiredRedemption>) -> Result<()> {
    let clock = Clock::get()?;
    let rr = &mut ctx.accounts.redemption_request;
    let rg = &ctx.accounts.redemption_guarantee;

    require!(clock.slot > rr.expiry_slot, SssError::RedemptionNotExpired);
    require!(
        ctx.accounts.config.insurance_fund_pubkey != Pubkey::default(),
        SssError::InsuranceFundNotConfigured
    );

    let amount = rr.amount;
    let stable_decimals = ctx.accounts.stable_mint.decimals;
    let penalty_decimals = ctx.accounts.penalty_mint.decimals;

    let mint_key = ctx.accounts.config.mint;
    let bump = rg.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        RedemptionGuarantee::SEED,
        mint_key.as_ref(),
        &[bump],
    ]];

    // Return stable tokens to user
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.escrow_stable.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.user_stable_ata.to_account_info(),
                authority: ctx.accounts.redemption_guarantee.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        stable_decimals,
    )?;

    // Penalty = 10% of amount, capped by insurance fund balance
    let penalty_amount = amount
        .saturating_mul(PENALTY_BPS)
        .saturating_div(10_000)
        .min(ctx.accounts.insurance_fund.amount);

    if penalty_amount > 0 {
        // Insurance fund authority = config PDA (authority already validated in config seeds)
        let config_seeds: &[&[&[u8]]] = &[&[
            StablecoinConfig::SEED,
            mint_key.as_ref(),
            &[ctx.accounts.config.bump],
        ]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.insurance_fund.to_account_info(),
                    mint: ctx.accounts.penalty_mint.to_account_info(),
                    to: ctx.accounts.user_collateral_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                config_seeds,
            ),
            penalty_amount,
            penalty_decimals,
        )?;
    }

    rr.sla_breached = true;

    emit!(RedemptionSLABreached {
        mint: ctx.accounts.config.mint,
        user: rr.user,
        amount,
        requested_slot: rr.requested_slot,
        expiry_slot: rr.expiry_slot,
        claim_slot: clock.slot,
        penalty_paid: penalty_amount,
    });

    msg!(
        "RedemptionSLABreached: user={} amount={} penalty={}",
        rr.user,
        amount,
        penalty_amount,
    );

    Ok(())
}
