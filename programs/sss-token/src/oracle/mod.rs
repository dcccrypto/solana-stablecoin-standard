//! SSS-119: Oracle Abstraction Layer
//!
//! Dispatches price fetches across three oracle adapters:
//!   0 = Pyth    — pyth-sdk-solana (existing production integration)
//!   1 = Switchboard — stub; returns OracleNotConfigured until crate is added
//!   2 = Custom  — on-chain CustomPriceFeed PDA signed/updated by authority

pub mod custom;
pub mod pyth;
pub mod switchboard;

use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::state::{OracleConsensus, StablecoinConfig, FLAG_MULTI_ORACLE_CONSENSUS};

/// Oracle type discriminant stored in StablecoinConfig.oracle_type.
pub const ORACLE_PYTH: u8 = 0;
pub const ORACLE_SWITCHBOARD: u8 = 1;
pub const ORACLE_CUSTOM: u8 = 2;

/// Normalised price returned by every oracle adapter.
#[derive(Debug, Clone, Copy)]
pub struct OraclePrice {
    /// Raw price value (positive).
    pub price: i64,
    /// Confidence interval (half-spread).
    pub conf: u64,
    /// Exponent — price in USD = price * 10^expo.
    /// Typically negative (e.g. -8 for 10^-8 USD per unit).
    pub expo: i32,
}

/// Fetch the current collateral price through the configured oracle adapter.
///
/// Steps:
///   1. Validate the feed account key against config (UnexpectedPriceFeed if mismatch).
///   2. Dispatch to the type-specific adapter to get a raw price.
///   3. Apply the confidence interval check from config.max_oracle_conf_bps.
///
/// Returns an `OraclePrice` or an Anchor error.
pub fn get_oracle_price(
    oracle_feed_acct: &AccountInfo,
    config: &StablecoinConfig,
    clock: &Clock,
) -> Result<OraclePrice> {
    // 1. Feed key validation
    validate_feed_key(oracle_feed_acct, config)?;

    let max_age_secs = if config.max_oracle_age_secs > 0 {
        config.max_oracle_age_secs as u64
    } else {
        60 // DEFAULT_MAX_PRICE_AGE_SECS
    };

    // 2. Dispatch to adapter
    let price = match config.oracle_type {
        ORACLE_PYTH => pyth::get_price(oracle_feed_acct, max_age_secs, clock.unix_timestamp)?,
        ORACLE_SWITCHBOARD => switchboard::get_price(oracle_feed_acct)?,
        ORACLE_CUSTOM => custom::get_price(oracle_feed_acct, config, max_age_secs, clock.unix_timestamp)?,
        _ => return err!(SssError::InvalidPriceFeed),
    };

    require!(price.price > 0, SssError::InvalidPrice);

    // 3. Confidence interval check
    let conf_bps_limit = config.max_oracle_conf_bps;
    if conf_bps_limit > 0 {
        let conf_ratio_bps = price.conf.saturating_mul(10_000) / price.price as u64;
        require!(
            conf_ratio_bps <= conf_bps_limit as u64,
            SssError::OracleConfidenceTooWide
        );
    }

    Ok(price)
}

/// C-1: Get oracle price, using consensus price as the canonical source when
/// `FLAG_MULTI_ORACLE_CONSENSUS` is set on the config.
///
/// Callers that hold an `OracleConsensus` PDA account should pass it here.
/// When the flag is set but no consensus account is provided, returns
/// `OracleConsensusNotFound`.  When the flag is not set, falls back to
/// `get_oracle_price` as usual.
pub fn get_effective_oracle_price(
    oracle_feed_acct: &AccountInfo,
    config: &StablecoinConfig,
    clock: &Clock,
    oracle_consensus: Option<&Account<OracleConsensus>>,
) -> Result<OraclePrice> {
    if config.feature_flags & FLAG_MULTI_ORACLE_CONSENSUS != 0 {
        let oc = oracle_consensus.ok_or(error!(SssError::OracleConsensusNotFound))?;
        let consensus_price = oc.last_consensus_price;
        require!(consensus_price > 0, SssError::InsufficientOracles);
        // Staleness: consensus must be within max_age_slots of current slot
        let current_slot = clock.slot;
        require!(
            current_slot.saturating_sub(oc.last_consensus_slot) <= oc.max_age_slots,
            SssError::StalePriceFeed
        );
        // Return consensus price with primary oracle's expo (for unit consistency).
        // Since both feeds are the same asset, expo is the same.
        Ok(OraclePrice {
            price: consensus_price as i64,
            conf: oc.last_consensus_conf,
            expo: -8, // canonical stablecoin collateral expo; TODO: store in OracleConsensus
        })
    } else {
        get_oracle_price(oracle_feed_acct, config, clock)
    }
}

/// Validate that the account passed by the caller is the expected feed for this config.
///
/// Priority:
///   1. If `config.oracle_feed` is set (non-default), the account must match exactly.
///   2. Else if oracle_type == Pyth and `config.expected_pyth_feed` is set,
///      fall back to the legacy field for backward compatibility (SSS-085).
fn validate_feed_key(oracle_feed_acct: &AccountInfo, config: &StablecoinConfig) -> Result<()> {
    let oracle_feed = config.oracle_feed;
    if oracle_feed != Pubkey::default() {
        require!(
            oracle_feed_acct.key() == oracle_feed,
            SssError::UnexpectedPriceFeed
        );
    } else if config.oracle_type == ORACLE_PYTH {
        // SSS-085 backward compatibility: use expected_pyth_feed when oracle_feed is unset
        let expected = config.expected_pyth_feed;
        if expected != Pubkey::default() {
            require!(
                oracle_feed_acct.key() == expected,
                SssError::UnexpectedPriceFeed
            );
        }
    }
    Ok(())
}
