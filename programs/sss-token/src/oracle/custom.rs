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
pub fn get_price(oracle_feed_acct: &AccountInfo, config: &StablecoinConfig) -> Result<OraclePrice> {
    // Deserialise and verify discriminator / program ownership
    let data = oracle_feed_acct
        .try_borrow_data()
        .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    let feed = CustomPriceFeed::try_deserialize(&mut data.as_ref())
        .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    // Admin signature verification: the feed must be controlled by this config's authority
    require!(feed.authority == config.authority, SssError::UnexpectedPriceFeed);

    Ok(OraclePrice {
        price: feed.price,
        conf: feed.conf,
        expo: feed.expo,
    })
}
