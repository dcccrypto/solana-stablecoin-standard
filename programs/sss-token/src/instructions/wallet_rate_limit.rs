use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::{WalletRateLimitRemoved, WalletRateLimitSet};
use crate::state::{StablecoinConfig, WalletRateLimit, FLAG_WALLET_RATE_LIMITS};

// ---------------------------------------------------------------------------
// SSS-133: Per-wallet rate limiting
// ---------------------------------------------------------------------------
//
// Adds address-level spend controls for corporate treasury use cases.
//
// A `WalletRateLimit` PDA (seeds: [b"wallet-rate-limit", sss_mint, wallet])
// caps a wallet's outbound transfers to `max_transfer_per_window` tokens
// within any contiguous `window_slots`-slot rolling window.
//
// The window resets automatically when `window_slots` slots have elapsed
// since `window_start_slot`.  The state is mutated in the transfer hook so
// every transfer is atomically counted against the window.
//
// Distinct from FLAG_SPEND_POLICY (global per-tx cap):
//   - FLAG_SPEND_POLICY: every transfer ≤ max_transfer_amount (global, one-shot)
//   - FLAG_WALLET_RATE_LIMITS: per-wallet cumulative window allowance
//
// Both flags may be active simultaneously; both checks must pass.
//
// Instructions:
//   set_wallet_rate_limit(wallet, max_per_window, window_slots) — authority only
//   remove_wallet_rate_limit(wallet)                            — authority only
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// set_wallet_rate_limit — create or overwrite a WalletRateLimit PDA
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetWalletRateLimitParams {
    /// Wallet (token account owner) to rate-limit.
    pub wallet: Pubkey,
    /// Maximum tokens the wallet may transfer within one window.
    pub max_transfer_per_window: u64,
    /// Window duration in slots (e.g. ~216_000 ≈ 1 day).
    pub window_slots: u64,
}

#[derive(Accounts)]
#[instruction(params: SetWalletRateLimitParams)]
pub struct SetWalletRateLimit<'info> {
    #[account(mut)]
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

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + WalletRateLimit::INIT_SPACE,
        seeds = [WalletRateLimit::SEED, mint.key().as_ref(), params.wallet.as_ref()],
        bump,
    )]
    pub wallet_rate_limit: Account<'info, WalletRateLimit>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn set_wallet_rate_limit_handler(
    ctx: Context<SetWalletRateLimit>,
    params: SetWalletRateLimitParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    // Validate flag is enabled
    require!(
        ctx.accounts.config.feature_flags & FLAG_WALLET_RATE_LIMITS != 0,
        SssError::WalletRateLimitsNotEnabled
    );
    require!(
        params.max_transfer_per_window > 0,
        SssError::InvalidRateLimitAmount
    );
    require!(params.window_slots > 0, SssError::InvalidRateLimitWindow);

    let wrl = &mut ctx.accounts.wallet_rate_limit;
    wrl.sss_mint = ctx.accounts.mint.key();
    wrl.wallet = params.wallet;
    wrl.max_transfer_per_window = params.max_transfer_per_window;
    wrl.window_slots = params.window_slots;
    // Reset window counters on set/update
    wrl.transferred_this_window = 0;
    wrl.window_start_slot = 0; // Will be set on first transfer
    wrl.bump = ctx.bumps.wallet_rate_limit;

    emit!(WalletRateLimitSet {
        mint: ctx.accounts.mint.key(),
        wallet: params.wallet,
        max_transfer_per_window: params.max_transfer_per_window,
        window_slots: params.window_slots,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "WalletRateLimit SET: wallet={} max_per_window={} window_slots={}",
        params.wallet,
        params.max_transfer_per_window,
        params.window_slots
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// remove_wallet_rate_limit — close the PDA and reclaim rent
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RemoveWalletRateLimit<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [WalletRateLimit::SEED, mint.key().as_ref(), wallet.as_ref()],
        bump = wallet_rate_limit.bump,
        close = authority,
    )]
    pub wallet_rate_limit: Account<'info, WalletRateLimit>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn remove_wallet_rate_limit_handler(
    ctx: Context<RemoveWalletRateLimit>,
    wallet: Pubkey,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    emit!(WalletRateLimitRemoved {
        mint: ctx.accounts.mint.key(),
        wallet,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "WalletRateLimit REMOVED: wallet={} mint={}",
        wallet,
        ctx.accounts.mint.key()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// update_wallet_rate_limit — called via CPI from transfer-hook to update counters
// ---------------------------------------------------------------------------
//
// The transfer-hook program (program-owned by sss-token) cannot write directly
// to WalletRateLimit accounts owned by sss-token.  Instead, the hook CPIs to
// this instruction in sss-token, which has write authority over its own PDAs.
//
// Security: The caller must be the registered transfer_hook_program on the mint.
//           Only the transfer amount and slot tracking fields are updated.
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateWalletRateLimitParams {
    /// The wallet whose rate limit window is being updated.
    pub wallet: Pubkey,
    /// Amount being transferred in this operation.
    pub transfer_amount: u64,
    /// Current slot (from Clock).
    pub current_slot: u64,
}

#[derive(Accounts)]
#[instruction(params: UpdateWalletRateLimitParams)]
pub struct UpdateWalletRateLimit<'info> {
    /// Must be the transfer-hook program or the sss-token authority.
    /// In practice the transfer-hook CPI uses its own program signing.
    pub caller: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [WalletRateLimit::SEED, mint.key().as_ref(), params.wallet.as_ref()],
        bump = wallet_rate_limit.bump,
    )]
    pub wallet_rate_limit: Account<'info, WalletRateLimit>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn update_wallet_rate_limit_handler(
    ctx: Context<UpdateWalletRateLimit>,
    params: UpdateWalletRateLimitParams,
) -> Result<()> {
    // Enforce: caller must be the registered transfer_hook_program on the config,
    // OR be the authority (for testing/emergency override).
    require!(
        ctx.accounts.caller.key() == ctx.accounts.config.transfer_hook_program
            || ctx.accounts.caller.key() == ctx.accounts.config.authority,
        SssError::Unauthorized
    );

    let wrl = &mut ctx.accounts.wallet_rate_limit;
    let current_slot = params.current_slot;

    // Reset window if elapsed
    if current_slot >= wrl.window_start_slot.saturating_add(wrl.window_slots) {
        wrl.transferred_this_window = 0;
        wrl.window_start_slot = current_slot;
    }

    let new_total = wrl
        .transferred_this_window
        .checked_add(params.transfer_amount)
        .ok_or(error!(SssError::WalletRateLimitExceeded))?;

    require!(
        new_total <= wrl.max_transfer_per_window,
        SssError::WalletRateLimitExceeded
    );

    wrl.transferred_this_window = new_total;

    msg!(
        "WalletRateLimit UPDATE: wallet={} transferred={} window_total={}",
        params.wallet,
        params.transfer_amount,
        new_total
    );
    Ok(())
}
