//! Typed instruction builders for SSS CPI calls.
//!
//! These builders construct [`solana_program::instruction::Instruction`]
//! values that can be passed to `invoke` or `invoke_signed` from any Solana
//! program, or used with `anchor_lang::solana_program::program::invoke*`.
//!
//! # Example — building a `cpi_mint` instruction
//!
//! ```rust,ignore
//! use sss_cpi::instructions::build_cpi_mint_ix;
//! use sss_cpi::pda::{find_config, find_interface_version, find_minter_info};
//! use anchor_lang::prelude::Pubkey;
//!
//! let mint = Pubkey::new_unique();
//! let minter = Pubkey::new_unique();
//! let (config, _) = find_config(&mint);
//! let (minter_info, _) = find_minter_info(&config, &minter);
//! let (iv_pda, _) = find_interface_version(&mint);
//! let recipient_ata = Pubkey::new_unique(); // Associated token account
//!
//! let ix = build_cpi_mint_ix(CpiMintArgs {
//!     minter,
//!     config,
//!     minter_info,
//!     mint,
//!     recipient_token_account: recipient_ata,
//!     interface_version_pda: iv_pda,
//!     token_program: spl_token_2022::ID,
//!     amount: 1_000_000,
//!     required_version: sss_cpi::CURRENT_INTERFACE_VERSION,
//! });
//! ```

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::AnchorSerialize;

use crate::discriminators::{DISCRIMINATOR_CPI_BURN, DISCRIMINATOR_CPI_MINT};
use crate::sss_program_id;

// ── CpiMint ───────────────────────────────────────────────────────────────────

/// Arguments for building a `cpi_mint` instruction.
#[derive(Debug, Clone)]
pub struct CpiMintArgs {
    /// The minter signer (must match a registered `MinterInfo` PDA).
    pub minter: Pubkey,
    /// The `StablecoinConfig` PDA.
    pub config: Pubkey,
    /// The `MinterInfo` PDA for this minter.
    pub minter_info: Pubkey,
    /// The Token-2022 mint account.
    pub mint: Pubkey,
    /// The recipient's token account (must be a Token-2022 account).
    pub recipient_token_account: Pubkey,
    /// The `InterfaceVersion` PDA.
    pub interface_version_pda: Pubkey,
    /// The token program (typically `spl_token_2022::ID`).
    pub token_program: Pubkey,
    /// Number of tokens to mint (in base units).
    pub amount: u64,
    /// Interface version the caller was compiled against.
    /// Use [`crate::CURRENT_INTERFACE_VERSION`].
    pub required_version: u8,
}

/// Build a raw `cpi_mint` [`Instruction`] for the SSS program.
///
/// The caller must sign as `minter`.
pub fn build_cpi_mint_ix(args: CpiMintArgs) -> Instruction {
    let mut data = DISCRIMINATOR_CPI_MINT.to_vec();
    args.amount.serialize(&mut data).unwrap();
    data.push(args.required_version);

    Instruction {
        program_id: sss_program_id(),
        accounts: vec![
            AccountMeta::new_readonly(args.minter, true),   // signer
            AccountMeta::new(args.config, false),
            AccountMeta::new(args.minter_info, false),
            AccountMeta::new(args.mint, false),
            AccountMeta::new(args.recipient_token_account, false),
            AccountMeta::new_readonly(args.interface_version_pda, false),
            AccountMeta::new_readonly(args.token_program, false),
        ],
        data,
    }
}

// ── CpiBurn ───────────────────────────────────────────────────────────────────

/// Arguments for building a `cpi_burn` instruction.
#[derive(Debug, Clone)]
pub struct CpiBurnArgs {
    /// The minter signer (must match a registered `MinterInfo` PDA).
    pub minter: Pubkey,
    /// The `StablecoinConfig` PDA.
    pub config: Pubkey,
    /// The `MinterInfo` PDA for this minter.
    pub minter_info: Pubkey,
    /// The Token-2022 mint account.
    pub mint: Pubkey,
    /// The source token account (tokens burned from here; owned by `minter`).
    pub source_token_account: Pubkey,
    /// The `InterfaceVersion` PDA.
    pub interface_version_pda: Pubkey,
    /// The token program (typically `spl_token_2022::ID`).
    pub token_program: Pubkey,
    /// Number of tokens to burn (in base units).
    pub amount: u64,
    /// Interface version the caller was compiled against.
    pub required_version: u8,
}

/// Build a raw `cpi_burn` [`Instruction`] for the SSS program.
///
/// The caller must sign as `minter`.
pub fn build_cpi_burn_ix(args: CpiBurnArgs) -> Instruction {
    let mut data = DISCRIMINATOR_CPI_BURN.to_vec();
    args.amount.serialize(&mut data).unwrap();
    data.push(args.required_version);

    Instruction {
        program_id: sss_program_id(),
        accounts: vec![
            AccountMeta::new_readonly(args.minter, true),   // signer
            AccountMeta::new(args.config, false),
            AccountMeta::new(args.minter_info, false),
            AccountMeta::new(args.mint, false),
            AccountMeta::new(args.source_token_account, false),
            AccountMeta::new_readonly(args.interface_version_pda, false),
            AccountMeta::new_readonly(args.token_program, false),
        ],
        data,
    }
}

// ── InterfaceVersion check helper ─────────────────────────────────────────────

/// Validates interface compatibility before invoking SSS via CPI.
///
/// Call this **before** building instructions to ensure the on-chain program
/// is still at the version your code was compiled against.
///
/// # Arguments
/// - `on_chain_version`: the `version` field read from the `InterfaceVersion` PDA.
/// - `on_chain_active`: the `active` field from the same PDA.
/// - `required_version`: your compile-time version (`CURRENT_INTERFACE_VERSION`).
///
/// # Errors
/// Returns `Err` if the interface is deprecated or versions differ.
pub fn check_interface_compatibility(
    on_chain_version: u8,
    on_chain_active: bool,
    required_version: u8,
) -> Result<(), InterfaceError> {
    if !on_chain_active {
        return Err(InterfaceError::Deprecated);
    }
    if on_chain_version != required_version {
        return Err(InterfaceError::VersionMismatch {
            expected: required_version,
            actual: on_chain_version,
        });
    }
    Ok(())
}

/// Errors returned by [`check_interface_compatibility`].
#[derive(Debug, PartialEq, Eq)]
pub enum InterfaceError {
    /// The SSS interface PDA has been marked inactive (program deprecated).
    Deprecated,
    /// The on-chain version does not match the caller's compiled version.
    VersionMismatch {
        /// Version the caller expects.
        expected: u8,
        /// Version currently deployed on-chain.
        actual: u8,
    },
}

impl std::fmt::Display for InterfaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InterfaceError::Deprecated => write!(f, "SSS interface deprecated"),
            InterfaceError::VersionMismatch { expected, actual } => {
                write!(
                    f,
                    "SSS interface version mismatch: expected {}, got {}",
                    expected, actual
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pda::{find_config, find_interface_version, find_minter_info};
    use crate::CURRENT_INTERFACE_VERSION;

    fn make_cpi_mint_args() -> CpiMintArgs {
        let mint = Pubkey::new_from_array([1u8; 32]);
        let minter = Pubkey::new_from_array([2u8; 32]);
        let (config, _) = find_config(&mint);
        let (minter_info, _) = find_minter_info(&config, &minter);
        let (iv, _) = find_interface_version(&mint);
        CpiMintArgs {
            minter,
            config,
            minter_info,
            mint,
            recipient_token_account: Pubkey::new_from_array([3u8; 32]),
            interface_version_pda: iv,
            token_program: Pubkey::new_from_array([4u8; 32]),
            amount: 1_000_000,
            required_version: CURRENT_INTERFACE_VERSION,
        }
    }

    fn make_cpi_burn_args() -> CpiBurnArgs {
        let mint = Pubkey::new_from_array([1u8; 32]);
        let minter = Pubkey::new_from_array([2u8; 32]);
        let (config, _) = find_config(&mint);
        let (minter_info, _) = find_minter_info(&config, &minter);
        let (iv, _) = find_interface_version(&mint);
        CpiBurnArgs {
            minter,
            config,
            minter_info,
            mint,
            source_token_account: Pubkey::new_from_array([5u8; 32]),
            interface_version_pda: iv,
            token_program: Pubkey::new_from_array([4u8; 32]),
            amount: 500_000,
            required_version: CURRENT_INTERFACE_VERSION,
        }
    }

    #[test]
    fn build_cpi_mint_ix_has_correct_program_id() {
        let ix = build_cpi_mint_ix(make_cpi_mint_args());
        assert_eq!(ix.program_id, crate::sss_program_id());
    }

    #[test]
    fn build_cpi_mint_ix_has_7_accounts() {
        let ix = build_cpi_mint_ix(make_cpi_mint_args());
        assert_eq!(ix.accounts.len(), 7);
    }

    #[test]
    fn build_cpi_mint_ix_minter_is_signer() {
        let ix = build_cpi_mint_ix(make_cpi_mint_args());
        assert!(ix.accounts[0].is_signer);
    }

    #[test]
    fn build_cpi_mint_ix_data_starts_with_discriminator() {
        let ix = build_cpi_mint_ix(make_cpi_mint_args());
        assert_eq!(&ix.data[..8], &DISCRIMINATOR_CPI_MINT);
    }

    #[test]
    fn build_cpi_burn_ix_has_correct_program_id() {
        let ix = build_cpi_burn_ix(make_cpi_burn_args());
        assert_eq!(ix.program_id, crate::sss_program_id());
    }

    #[test]
    fn build_cpi_burn_ix_has_7_accounts() {
        let ix = build_cpi_burn_ix(make_cpi_burn_args());
        assert_eq!(ix.accounts.len(), 7);
    }

    #[test]
    fn build_cpi_burn_ix_data_starts_with_discriminator() {
        let ix = build_cpi_burn_ix(make_cpi_burn_args());
        assert_eq!(&ix.data[..8], &DISCRIMINATOR_CPI_BURN);
    }

    #[test]
    fn cpi_mint_and_burn_instructions_differ() {
        let mint_ix = build_cpi_mint_ix(make_cpi_mint_args());
        let burn_ix = build_cpi_burn_ix(make_cpi_burn_args());
        assert_ne!(&mint_ix.data[..8], &burn_ix.data[..8]);
    }

    #[test]
    fn check_interface_ok_when_active_and_version_matches() {
        assert!(check_interface_compatibility(1, true, 1).is_ok());
    }

    #[test]
    fn check_interface_err_when_deprecated() {
        assert_eq!(
            check_interface_compatibility(1, false, 1),
            Err(InterfaceError::Deprecated)
        );
    }

    #[test]
    fn check_interface_err_when_version_mismatch() {
        assert_eq!(
            check_interface_compatibility(2, true, 1),
            Err(InterfaceError::VersionMismatch {
                expected: 1,
                actual: 2,
            })
        );
    }

    #[test]
    fn interface_error_display_deprecated() {
        let msg = InterfaceError::Deprecated.to_string();
        assert!(msg.contains("deprecated"));
    }

    #[test]
    fn interface_error_display_version_mismatch() {
        let msg = InterfaceError::VersionMismatch {
            expected: 1,
            actual: 2,
        }
        .to_string();
        assert!(msg.contains("1") && msg.contains("2"));
    }
}
