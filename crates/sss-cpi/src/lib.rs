//! # sss-cpi
//!
//! Rust CPI client library for the **Solana Stablecoin Standard (SSS)** on-chain program.
//!
//! External Solana programs and off-chain clients can use this crate to:
//! - Build typed instruction data for `cpi_mint` and `cpi_burn`.
//! - Derive all PDAs used by the SSS program deterministically.
//! - Verify interface version compatibility before invoking.
//! - Dispatch via the discriminator-based SSS CPI interface.
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use sss_cpi::{accounts::CpiMintAccounts, pda, instructions};
//! use anchor_lang::prelude::*;
//!
//! let mint = Pubkey::new_unique();
//! let (config_pda, _) = pda::find_config(&mint);
//! let minter = Pubkey::new_unique();
//! let (minter_info_pda, _) = pda::find_minter_info(&config_pda, &minter);
//! ```
//!
//! ## Feature Flags
//!
//! Enable the `cpi` feature to get the full Anchor-generated CPI module
//! (requires the `sss-token` crate).
//!
//! ```toml
//! sss-cpi = { version = "0.1", features = ["cpi"] }
//! ```

#![deny(missing_docs)]
#![deny(clippy::all)]

pub mod discriminators;
pub mod flags;
pub mod instructions;
pub mod pda;
pub mod version;

#[cfg(feature = "cpi")]
pub mod cpi_module;

/// The deployed program ID for the SSS on-chain program.
///
/// Replace this value if you deploy a fork or test instance.
pub const SSS_PROGRAM_ID_STR: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";

use anchor_lang::prelude::Pubkey;
use std::str::FromStr;

/// Returns the SSS program [`Pubkey`].
pub fn sss_program_id() -> Pubkey {
    Pubkey::from_str(SSS_PROGRAM_ID_STR).expect("valid program id")
}

/// Re-export commonly-used types at the crate root.
pub use discriminators::{DISCRIMINATOR_CPI_BURN, DISCRIMINATOR_CPI_MINT};
pub use flags::*;
pub use pda::*;
pub use version::CURRENT_INTERFACE_VERSION;
