//! Interface version constants and compatibility helpers.
//!
//! The SSS CPI interface uses a versioned PDA (`InterfaceVersion`) to signal
//! breaking changes.  Callers pin to a version at compile time; the on-chain
//! program rejects calls that provide a mismatching version.

/// The interface version this library was compiled against.
///
/// Increment this when a breaking change is made to the CPI instruction layout.
pub const CURRENT_INTERFACE_VERSION: u8 = 1;

/// Minimum interface version supported by this library.
pub const MIN_SUPPORTED_VERSION: u8 = 1;

/// Returns `true` if `version` is within the supported range.
///
/// ```rust
/// use sss_cpi::version::is_supported_version;
/// assert!(is_supported_version(1));
/// assert!(!is_supported_version(0));
/// ```
pub fn is_supported_version(version: u8) -> bool {
    version >= MIN_SUPPORTED_VERSION && version <= CURRENT_INTERFACE_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_version_is_supported() {
        assert!(is_supported_version(CURRENT_INTERFACE_VERSION));
    }

    #[test]
    fn zero_is_not_supported() {
        assert!(!is_supported_version(0));
    }

    #[test]
    fn future_version_not_supported() {
        assert!(!is_supported_version(255));
    }
}
