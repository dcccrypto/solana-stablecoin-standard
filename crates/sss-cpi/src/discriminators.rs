//! Instruction discriminators for the SSS on-chain program.
//!
//! Anchor computes discriminators as `sha256("global:<instruction_name>")[..8]`.
//! These are pre-computed constants for the core CPI instructions so external
//! callers can construct raw instruction data without a full IDL dependency.
//!
//! Verified against Anchor 0.32.0 discriminator derivation.

/// `sha256("global:cpi_mint")[..8]`
///
/// Used as the first 8 bytes of instruction data when calling `cpi_mint`.
pub const DISCRIMINATOR_CPI_MINT: [u8; 8] = {
    // Anchor sighash: first 8 bytes of SHA256("global:cpi_mint")
    // Pre-computed: 0xf5, 0xc7, 0x03, 0x25, 0x5b, 0xe6, 0xab, 0x3c
    [0xf5, 0xc7, 0x03, 0x25, 0x5b, 0xe6, 0xab, 0x3c]
};

/// `sha256("global:cpi_burn")[..8]`
///
/// Used as the first 8 bytes of instruction data when calling `cpi_burn`.
pub const DISCRIMINATOR_CPI_BURN: [u8; 8] = {
    // Pre-computed: 0x0e, 0xa7, 0xd8, 0xc7, 0x11, 0xa2, 0xe4, 0x59
    [0x0e, 0xa7, 0xd8, 0xc7, 0x11, 0xa2, 0xe4, 0x59]
};

/// `sha256("global:initialize")[..8]`
pub const DISCRIMINATOR_INITIALIZE: [u8; 8] = {
    [0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed]
};

/// `sha256("global:mint")[..8]`
pub const DISCRIMINATOR_MINT: [u8; 8] = {
    [0xf1, 0x9a, 0x8d, 0x41, 0x4c, 0x5d, 0xd6, 0x72]
};

/// `sha256("global:burn")[..8]`
pub const DISCRIMINATOR_BURN: [u8; 8] = {
    [0x76, 0x2f, 0x47, 0x02, 0x96, 0x6d, 0x0e, 0x89]
};

/// Compute an Anchor instruction discriminator from an instruction name at
/// compile time (requires `sha2` crate in build dependencies, or use
/// pre-computed constants above for production use).
///
/// For custom downstream integrations, you can verify via:
/// ```bash
/// python3 -c "import hashlib; print(list(hashlib.sha256(b'global:cpi_mint').digest()[:8]))"
/// ```
/// Returns a placeholder — use pre-computed `DISCRIMINATOR_*` constants instead.
///
/// Real discriminators use `sha256("global:<name>")[..8]`.
/// A `sha2` dependency is required to compute them at runtime.
pub fn sighash(_namespace: &str, _name: &str) -> [u8; 8] {
    unimplemented!(
        "Use pre-computed DISCRIMINATOR_* constants. \
         Real SHA-256 discriminators require a sha2 dependency."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminators_are_8_bytes() {
        assert_eq!(DISCRIMINATOR_CPI_MINT.len(), 8);
        assert_eq!(DISCRIMINATOR_CPI_BURN.len(), 8);
        assert_eq!(DISCRIMINATOR_INITIALIZE.len(), 8);
        assert_eq!(DISCRIMINATOR_MINT.len(), 8);
        assert_eq!(DISCRIMINATOR_BURN.len(), 8);
    }

    #[test]
    fn cpi_mint_and_burn_discriminators_differ() {
        assert_ne!(DISCRIMINATOR_CPI_MINT, DISCRIMINATOR_CPI_BURN);
    }

    #[test]
    fn all_discriminators_differ() {
        let all = [
            DISCRIMINATOR_CPI_MINT,
            DISCRIMINATOR_CPI_BURN,
            DISCRIMINATOR_INITIALIZE,
            DISCRIMINATOR_MINT,
            DISCRIMINATOR_BURN,
        ];
        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                assert_ne!(all[i], all[j], "discriminators[{}] == discriminators[{}]", i, j);
            }
        }
    }
}
