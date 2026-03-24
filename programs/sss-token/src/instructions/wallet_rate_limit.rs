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
