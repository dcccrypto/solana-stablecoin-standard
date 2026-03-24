//! SSS-119: Oracle configuration instructions.
//!
//! - `set_oracle_config`      — authority-only; sets oracle_type + oracle_feed on StablecoinConfig.
//! - `init_custom_price_feed` — authority-only; initialises the CustomPriceFeed PDA for a mint.
//! - `update_custom_price`    — authority-only; writes a new price into the CustomPriceFeed PDA.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::oracle::{ORACLE_CUSTOM, ORACLE_PYTH, ORACLE_SWITCHBOARD};
use crate::state::{CustomPriceFeed, StablecoinConfig};

// ---------------------------------------------------------------------------
// set_oracle_config
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetOracleConfig<'info> {
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

    pub token_program: Interface<'info, TokenInterface>,
}

/// Set the oracle type and feed address for a stablecoin config.
///
/// `oracle_type`: 0=Pyth, 1=Switchboard, 2=Custom.
/// `oracle_feed`: The feed account address (Pyth price feed, or CustomPriceFeed PDA).
///   Pass Pubkey::default() to clear the field (disables feed key enforcement for Pyth).
pub fn set_oracle_config_handler(
    ctx: Context<SetOracleConfig>,
    oracle_type: u8,
    oracle_feed: Pubkey,
) -> Result<()> {
    require!(
        oracle_type == ORACLE_PYTH
            || oracle_type == ORACLE_SWITCHBOARD
            || oracle_type == ORACLE_CUSTOM,
        SssError::InvalidOracleType
    );
    let config = &mut ctx.accounts.config;
    config.oracle_type = oracle_type;
    config.oracle_feed = oracle_feed;
    msg!(
        "SSS-119: oracle_type={} oracle_feed={}",
        oracle_type,
        oracle_feed,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// init_custom_price_feed
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitCustomPriceFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The SSS-3 stablecoin mint (used to derive the CustomPriceFeed PDA).
    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// CustomPriceFeed PDA — one per stablecoin mint.
    /// Seeds: [b"custom-price-feed", sss_mint]
    #[account(
        init,
        payer = authority,
        space = 8 + CustomPriceFeed::INIT_SPACE,
        seeds = [CustomPriceFeed::SEED, sss_mint.key().as_ref()],
        bump,
    )]
    pub custom_price_feed: Account<'info, CustomPriceFeed>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialise the CustomPriceFeed PDA for a stablecoin mint.
/// Sets `authority` to the caller and price fields to 0 (must be updated before use).
pub fn init_custom_price_feed_handler(ctx: Context<InitCustomPriceFeed>) -> Result<()> {
    let feed = &mut ctx.accounts.custom_price_feed;
    feed.authority = ctx.accounts.authority.key();
    feed.price = 0;
    feed.expo = -8; // Conventional default exponent (overrideable via update_custom_price)
    feed.conf = 0;
    feed.last_update_slot = 0;
    feed.last_update_unix_timestamp = 0; // 0 = never updated; staleness check will reject until first update
    feed.bump = ctx.bumps.custom_price_feed;
    msg!(
        "SSS-119: CustomPriceFeed initialised for mint {}",
        ctx.accounts.sss_mint.key()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// update_custom_price
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdateCustomPrice<'info> {
    /// The stablecoin authority — must match custom_price_feed.authority.
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [CustomPriceFeed::SEED, sss_mint.key().as_ref()],
        bump = custom_price_feed.bump,
        constraint = custom_price_feed.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub custom_price_feed: Account<'info, CustomPriceFeed>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Publish a new price to the CustomPriceFeed PDA.
/// Authority-only — the admin's signature on this transaction is the
/// "admin signature verification" that the custom oracle adapter relies on.
///
/// `price`: raw price value (must be > 0).
/// `expo`: price exponent (e.g. -8 → USD price = price * 10^-8).
/// `conf`: confidence half-interval in the same units as price (0 = no uncertainty).
pub fn update_custom_price_handler(
    ctx: Context<UpdateCustomPrice>,
    price: i64,
    expo: i32,
    conf: u64,
) -> Result<()> {
    require!(price > 0, SssError::InvalidPrice);
    let clock = Clock::get()?;
    let feed = &mut ctx.accounts.custom_price_feed;
    feed.price = price;
    feed.expo = expo;
    feed.conf = conf;
    feed.last_update_slot = clock.slot;
    feed.last_update_unix_timestamp = clock.unix_timestamp;
    msg!(
        "SSS-119: CustomPriceFeed updated — price={} expo={} conf={} slot={} ts={}",
        price,
        expo,
        conf,
        clock.slot,
        clock.unix_timestamp,
    );
    Ok(())
}
