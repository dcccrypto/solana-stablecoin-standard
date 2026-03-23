//! Pyth oracle adapter — wraps pyth-sdk-solana price account reads.

use anchor_lang::prelude::*;
use pyth_sdk_solana::state::SolanaPriceAccount;

use crate::error::SssError;

use super::OraclePrice;

/// Read the current price from a Pyth price feed account.
///
/// Verifies the price is no older than `max_age_secs` relative to
/// `unix_timestamp` from the on-chain Clock.
pub fn get_price(
    oracle_feed_acct: &AccountInfo,
    max_age_secs: u64,
    unix_timestamp: i64,
) -> Result<OraclePrice> {
    let price_feed = SolanaPriceAccount::account_info_to_feed(oracle_feed_acct)
        .map_err(|_| error!(SssError::InvalidPriceFeed))?;

    let price = price_feed
        .get_price_no_older_than(unix_timestamp, max_age_secs)
        .ok_or(error!(SssError::StalePriceFeed))?;

    Ok(OraclePrice {
        price: price.price,
        conf: price.conf,
        expo: price.expo,
    })
}
