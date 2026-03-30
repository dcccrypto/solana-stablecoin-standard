//! SSS-138: Market maker hooks — programmatic peg spread management.
//!
//! Implements `FLAG_MARKET_MAKER_HOOKS` (bit 18).
//!
//! Architecture:
//! - `MarketMakerConfig` PDA: per-mint market maker configuration (whitelist, rate limits, spread).
//! - `init_market_maker_config(...)`: authority-only setup of the config PDA.
//! - `register_market_maker(mm_pubkey)`: authority-only, adds a pubkey to the whitelist.
//! - `mm_mint(amount)`: whitelisted MM mints tokens; subject to per-slot limit + oracle spread.
//! - `mm_burn(amount)`: whitelisted MM burns tokens; subject to per-slot limit + oracle spread.
//! - `get_mm_capacity()`: read-only, emits remaining mint/burn capacity for the current slot.
//!
//! Security model:
//! - Both `mm_mint` and `mm_burn` bypass stability fees.
//! - Rate limits reset automatically when slot advances.
//! - Oracle spread check uses the existing oracle abstraction layer.
//!   If `oracle_feed == Pubkey::default()`, spread check is skipped (useful in tests with
//!   no oracle configured; on mainnet always configure an oracle feed).
//! - FLAG_SQUADS_AUTHORITY is enforced on all authority-gated instructions.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::events::{MarketMakerConfigInitialized, MarketMakerRegistered, MmBurn, MmCapacity, MmMint};
use crate::oracle;
use crate::state::{MarketMakerConfig, StablecoinConfig, FLAG_CIRCUIT_BREAKER, FLAG_MARKET_MAKER_HOOKS};

/// Peg price in micro-USD (1.000000 USD = 1_000_000 µUSD).
const PEG_PRICE_MICRO_USD: i64 = 1_000_000;

// ---------------------------------------------------------------------------
// Helper: spread check against oracle price
// ---------------------------------------------------------------------------

/// Returns the oracle price in µUSD (6dp) from an oracle feed account,
/// using the existing SSS oracle abstraction.
///
/// If oracle_feed is Pubkey::default() (no feed configured), returns `None`
/// — caller decides whether to allow or deny.
fn check_oracle_spread(
    oracle_feed_acct: &AccountInfo,
    config: &StablecoinConfig,
    spread_bps: u16,
    clock: &Clock,
) -> Result<()> {
    // Skip check if no oracle feed is configured (test / pre-mainnet mode).
    if config.oracle_feed == Pubkey::default() {
        return Ok(());
    }

    let price = oracle::get_oracle_price(oracle_feed_acct, config, clock)?;

    // Normalise oracle price to µUSD (6dp):
    // oracle price is price * 10^expo USD. We want µUSD = price * 10^(6 + expo).
    let price_in_micro_usd: i64 = if price.expo >= 0 {
        price
            .price
            .saturating_mul(10i64.pow(price.expo as u32))
            .saturating_mul(1_000_000)
    } else {
        let exp_abs = price.expo.unsigned_abs();
        if exp_abs > 6 {
            // expo < -6: divide down to µUSD scale
            let divisor = 10i64.pow(exp_abs - 6);
            price.price.saturating_div(divisor)
        } else {
            // expo in [-6, 0]: multiply up
            price.price.saturating_mul(10i64.pow(6 - exp_abs))
        }
    };

    // |oracle_price_µUSD - peg| <= spread_bps * 100 µUSD
    // (spread_bps 50 → 5000 µUSD = 0.5 cents tolerance at $1 peg)
    let tolerance = (spread_bps as i64).saturating_mul(100);
    let deviation = (price_in_micro_usd - PEG_PRICE_MICRO_USD).abs();

    require!(deviation <= tolerance, SssError::OraclePriceOutsideSpread);
    Ok(())
}

// ---------------------------------------------------------------------------
// init_market_maker_config
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitMarketMakerConfigParams {
    pub mm_mint_limit_per_slot: u64,
    pub mm_burn_limit_per_slot: u64,
    /// Spread tolerance in basis points (e.g. 50 = 0.5%).
    pub spread_bps: u16,
}

#[derive(Accounts)]
pub struct InitMarketMakerConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + MarketMakerConfig::INIT_SPACE,
        seeds = [MarketMakerConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub mm_config: Box<Account<'info, MarketMakerConfig>>,

    pub system_program: Program<'info, System>,
}

pub fn init_market_maker_config_handler(
    ctx: Context<InitMarketMakerConfig>,
    params: InitMarketMakerConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        ctx.accounts.config.feature_flags & FLAG_MARKET_MAKER_HOOKS != 0,
        SssError::MarketMakerHooksNotEnabled
    );

    let mm_config = &mut ctx.accounts.mm_config;
    mm_config.sss_mint = ctx.accounts.mint.key();
    mm_config.whitelisted_mms = Vec::new();
    mm_config.mm_mint_limit_per_slot = params.mm_mint_limit_per_slot;
    mm_config.mm_burn_limit_per_slot = params.mm_burn_limit_per_slot;
    mm_config.spread_bps = params.spread_bps;
    mm_config.last_mint_slot = 0;
    mm_config.mm_minted_this_slot = 0;
    mm_config.last_burn_slot = 0;
    mm_config.mm_burned_this_slot = 0;
    mm_config.bump = ctx.bumps.mm_config;

    emit!(MarketMakerConfigInitialized {
        mint: ctx.accounts.mint.key(),
        mm_mint_limit_per_slot: params.mm_mint_limit_per_slot,
        mm_burn_limit_per_slot: params.mm_burn_limit_per_slot,
        spread_bps: params.spread_bps,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "MarketMakerConfig INIT: mint={} mint_limit={} burn_limit={} spread_bps={}",
        ctx.accounts.mint.key(),
        params.mm_mint_limit_per_slot,
        params.mm_burn_limit_per_slot,
        params.spread_bps
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// register_market_maker
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RegisterMarketMaker<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [MarketMakerConfig::SEED, mint.key().as_ref()],
        bump = mm_config.bump,
    )]
    pub mm_config: Box<Account<'info, MarketMakerConfig>>,
}

pub fn register_market_maker_handler(
    ctx: Context<RegisterMarketMaker>,
    mm_pubkey: Pubkey,
) -> Result<()> {
    // SSS-138: FLAG_MARKET_MAKER_HOOKS must be active
    require!(
        ctx.accounts.config.feature_flags & FLAG_MARKET_MAKER_HOOKS != 0,
        SssError::MarketMakerHooksDisabled
    );

    // SSS-135: Squads check
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let mm_config = &mut ctx.accounts.mm_config;

    require!(
        !mm_config.whitelisted_mms.contains(&mm_pubkey),
        SssError::MarketMakerAlreadyRegistered
    );
    require!(mm_config.whitelisted_mms.len() < 10, SssError::MarketMakerListFull);

    mm_config.whitelisted_mms.push(mm_pubkey);

    emit!(MarketMakerRegistered {
        mint: ctx.accounts.mint.key(),
        market_maker: mm_pubkey,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "MarketMaker REGISTERED: mm={} mint={} total={}",
        mm_pubkey,
        ctx.accounts.mint.key(),
        mm_config.whitelisted_mms.len()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// mm_mint
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MmMintAccounts<'info> {
    /// The whitelisted market maker.
    pub market_maker: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [MarketMakerConfig::SEED, mint.key().as_ref()],
        bump = mm_config.bump,
    )]
    pub mm_config: Box<Account<'info, MarketMakerConfig>>,

    /// Token account to receive minted tokens (owned by market_maker).
    #[account(
        mut,
        constraint = mm_token_account.mint == mint.key() @ SssError::TokenAccountMintMismatch,
        constraint = mm_token_account.owner == market_maker.key() @ SssError::TokenAccountOwnerMismatch,
    )]
    pub mm_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Oracle price feed — validated inside handler via oracle abstraction.
    /// Pass Pubkey::default() account info when oracle_feed == Pubkey::default().
    pub oracle_feed: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn mm_mint_handler(ctx: Context<MmMintAccounts>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    // 0. FLAG_MARKET_MAKER_HOOKS must be enabled
    require!(
        ctx.accounts.config.feature_flags & FLAG_MARKET_MAKER_HOOKS != 0,
        SssError::MarketMakerHooksDisabled
    );

    // AUDIT2-A BUG FIX: MM mint must respect the circuit breaker.
    // Without this check, a whitelisted MM could mint during an emergency halt,
    // inflating supply while the protocol is paused for safety.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // 1. Whitelist check
    let mm_key = ctx.accounts.market_maker.key();
    require!(
        ctx.accounts.mm_config.whitelisted_mms.contains(&mm_key),
        SssError::NotWhitelistedMarketMaker
    );

    // 2. Oracle spread check (skipped if no feed configured)
    let clock = Clock::get()?;
    check_oracle_spread(
        ctx.accounts.oracle_feed.as_ref(),
        &ctx.accounts.config,
        ctx.accounts.mm_config.spread_bps,
        &clock,
    )?;

    // 3. Per-slot rate limit
    let current_slot = clock.slot;
    let mm_config = &mut ctx.accounts.mm_config;

    if current_slot != mm_config.last_mint_slot {
        mm_config.mm_minted_this_slot = 0;
        mm_config.last_mint_slot = current_slot;
    }

    let new_total = mm_config
        .mm_minted_this_slot
        .checked_add(amount)
        .ok_or(error!(SssError::MmMintLimitExceeded))?;

    require!(
        new_total <= mm_config.mm_mint_limit_per_slot,
        SssError::MmMintLimitExceeded
    );

    mm_config.mm_minted_this_slot = new_total;

    // 4. Max supply check
    {
        let config = &ctx.accounts.config;
        if config.max_supply > 0 {
            require!(
                config.net_supply().checked_add(amount).unwrap_or(u64::MAX) <= config.max_supply,
                SssError::MaxSupplyExceeded
            );
        }
    }

    // 5. Mint tokens (bypass stability fee — MM ops are fee-free)
    let config_key = ctx.accounts.config.mint;
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[StablecoinConfig::SEED, config_key.as_ref(), &[bump]];
    let signer_seeds = &[seeds];

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.mm_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // 6. Update StablecoinConfig supply totals
    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted.checked_add(amount).unwrap();

    emit!(MmMint {
        mint: ctx.accounts.mint.key(),
        market_maker: mm_key,
        amount,
        slot: current_slot,
    });

    msg!("mm_mint: mm={} amount={} slot={}", mm_key, amount, current_slot);
    Ok(())
}

// ---------------------------------------------------------------------------
// mm_burn
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MmBurnAccounts<'info> {
    /// The whitelisted market maker.
    pub market_maker: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [MarketMakerConfig::SEED, mint.key().as_ref()],
        bump = mm_config.bump,
    )]
    pub mm_config: Box<Account<'info, MarketMakerConfig>>,

    /// Token account to burn from (owned by market_maker).
    #[account(
        mut,
        constraint = mm_token_account.mint == mint.key() @ SssError::TokenAccountMintMismatch,
        constraint = mm_token_account.owner == market_maker.key() @ SssError::TokenAccountOwnerMismatch,
    )]
    pub mm_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Oracle price feed — validated inside handler via oracle abstraction.
    pub oracle_feed: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn mm_burn_handler(ctx: Context<MmBurnAccounts>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    // 0. FLAG_MARKET_MAKER_HOOKS must be enabled
    require!(
        ctx.accounts.config.feature_flags & FLAG_MARKET_MAKER_HOOKS != 0,
        SssError::MarketMakerHooksDisabled
    );

    // AUDIT2-A BUG FIX: MM burn must respect the circuit breaker.
    // Allow burn during circuit breaker (deflation is safe); only block mint.
    // Note: burn is safe to permit even under CB (reduces supply, not inflating it).
    // Keeping this check as a conservative safety measure consistent with mm_mint.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // 1. Whitelist check
    let mm_key = ctx.accounts.market_maker.key();
    require!(
        ctx.accounts.mm_config.whitelisted_mms.contains(&mm_key),
        SssError::NotWhitelistedMarketMaker
    );

    // 2. Oracle spread check
    let clock = Clock::get()?;
    check_oracle_spread(
        ctx.accounts.oracle_feed.as_ref(),
        &ctx.accounts.config,
        ctx.accounts.mm_config.spread_bps,
        &clock,
    )?;

    // 3. Per-slot rate limit
    let current_slot = clock.slot;
    let mm_config = &mut ctx.accounts.mm_config;

    if current_slot != mm_config.last_burn_slot {
        mm_config.mm_burned_this_slot = 0;
        mm_config.last_burn_slot = current_slot;
    }

    let new_total = mm_config
        .mm_burned_this_slot
        .checked_add(amount)
        .ok_or(error!(SssError::MmBurnLimitExceeded))?;

    require!(
        new_total <= mm_config.mm_burn_limit_per_slot,
        SssError::MmBurnLimitExceeded
    );

    mm_config.mm_burned_this_slot = new_total;

    // 4. Burn tokens
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.mm_token_account.to_account_info(),
                authority: ctx.accounts.market_maker.to_account_info(),
            },
        ),
        amount,
    )?;

    // 5. Update StablecoinConfig supply totals
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(amount).unwrap();

    emit!(MmBurn {
        mint: ctx.accounts.mint.key(),
        market_maker: mm_key,
        amount,
        slot: current_slot,
    });

    msg!("mm_burn: mm={} amount={} slot={}", mm_key, amount, current_slot);
    Ok(())
}

// ---------------------------------------------------------------------------
// get_mm_capacity (read-only / view)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct GetMmCapacity<'info> {
    #[account(
        seeds = [MarketMakerConfig::SEED, mint.key().as_ref()],
        bump = mm_config.bump,
    )]
    pub mm_config: Box<Account<'info, MarketMakerConfig>>,

    pub mint: InterfaceAccount<'info, Mint>,
}

pub fn get_mm_capacity_handler(ctx: Context<GetMmCapacity>) -> Result<()> {
    let clock = Clock::get()?;
    let current_slot = clock.slot;
    let mm_config = &ctx.accounts.mm_config;

    let minted = if current_slot == mm_config.last_mint_slot {
        mm_config.mm_minted_this_slot
    } else {
        0
    };
    let burned = if current_slot == mm_config.last_burn_slot {
        mm_config.mm_burned_this_slot
    } else {
        0
    };

    let mint_remaining = mm_config.mm_mint_limit_per_slot.saturating_sub(minted);
    let burn_remaining = mm_config.mm_burn_limit_per_slot.saturating_sub(burned);

    emit!(MmCapacity {
        mint: ctx.accounts.mint.key(),
        mint_remaining,
        burn_remaining,
        slot: current_slot,
    });

    msg!(
        "get_mm_capacity: mint_remaining={} burn_remaining={} slot={}",
        mint_remaining,
        burn_remaining,
        current_slot
    );
    Ok(())
}
