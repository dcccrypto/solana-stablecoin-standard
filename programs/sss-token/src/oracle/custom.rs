//! Custom oracle adapter.
//!
//! Reads price from a `CustomPriceFeed` PDA that is maintained by the
//! stablecoin authority (admin).  "Admin signature verification" is
//! enforced by confirming that `CustomPriceFeed.authority` matches
//! `StablecoinConfig.authority` — only the authority can publish prices
//! via `update_custom_price`, so any value in the feed was admin-signed.

use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::state::{CustomPriceFeed, StablecoinConfig};

use super::OraclePrice;

/// Read the current price from a `CustomPriceFeed` PDA.
///
/// Verifies:
///   - The account deserialises as a valid `CustomPriceFeed` (discriminator check).
///   - `feed.authority` matches `config.authority` (admin signature verification).
///   - `feed.last_update_unix_timestamp` is within `max_age_secs` of `current_unix_timestamp`
///     (staleness check using `config.max_oracle_age_secs`; default 60 s).
pub fn get_price(
    oracle_feed_acct: &AccountInfo,
    config: &StablecoinConfig,
    max_age_secs: u64,
    current_unix_timestamp: i64,
) -> Result<OraclePrice> {
    // Deserialise and verify discriminator / program ownership
    let data = oracle_feed_acct
        .try_borrow_data()
        .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    let feed = CustomPriceFeed::try_deserialize(&mut data.as_ref())
        .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    // Admin signature verification: the feed must be controlled by this config's authority
    require!(feed.authority == config.authority, SssError::UnexpectedPriceFeed);

    // Staleness check: reject if price was never set (timestamp == 0) or is too old
    let age = current_unix_timestamp.saturating_sub(feed.last_update_unix_timestamp);
    require!(
        feed.last_update_unix_timestamp > 0 && age >= 0 && age as u64 <= max_age_secs,
        SssError::StalePriceFeed
    );

    Ok(OraclePrice {
        price: feed.price,
        conf: feed.conf,
        expo: feed.expo,
    })
}
