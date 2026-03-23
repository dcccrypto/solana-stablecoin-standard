//! Switchboard V2 oracle adapter — stub implementation.
//!
//! The `switchboard-v2` crate is not yet a declared workspace dependency.
//! Until it is added to Cargo.toml this adapter returns `OracleNotConfigured`
//! so that the oracle dispatch table compiles and tests can verify the error.
//!
//! To integrate Switchboard V2:
//!   1. Add `switchboard-v2 = "0.4"` (or workspace dep) to programs/sss-token/Cargo.toml.
//!   2. Replace the stub body with an `AggregatorAccountData` read, e.g.:
//!      ```ignore
//!      use switchboard_v2::AggregatorAccountData;
//!      let feed = AggregatorAccountData::new(oracle_feed_acct)?;
//!      let result = feed.get_result()?;
//!      let price_f64 = result.try_into_f64()?;
//!      ```

use anchor_lang::prelude::*;

use crate::error::SssError;

use super::OraclePrice;

/// Switchboard V2 price read — stub returns OracleNotConfigured.
pub fn get_price(_oracle_feed_acct: &AccountInfo) -> Result<OraclePrice> {
    err!(SssError::OracleNotConfigured)
}
