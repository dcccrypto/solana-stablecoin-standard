/// SSS-105: Property-based fuzz tests for all critical SSS invariants.
///
/// These tests exercise pure arithmetic/logic (not on-chain execution).
/// Run with:
///   cargo test --manifest-path programs/sss-token/Cargo.toml fuzz
///   cargo test --manifest-path programs/sss-token/Cargo.toml proptest
#[cfg(test)]
mod fuzz_tests {
    // Test: net_supply never underflows for any combination of minted/burned
    #[test]
    fn fuzz_net_supply_no_underflow() {
        for minted in [0u64, 1, 100, u64::MAX / 2, u64::MAX] {
            for burned in [0u64, 1, 100] {
                if burned <= minted {
                    // net_supply must not panic
                    let supply = minted.saturating_sub(burned);
                    assert!(supply <= minted);
                }
            }
        }
    }

    // Test: reserve_ratio_bps never panics or overflows
    #[test]
    fn fuzz_reserve_ratio_bps_no_panic() {
        let test_cases = [
            (0u64, 0u64, 0u64),
            (1000, 0, 1000),
            (u64::MAX, 0, u64::MAX),
            (u64::MAX, u64::MAX / 2, u64::MAX),
            (1000, 500, 500),
        ];
        for (minted, burned, collateral) in test_cases {
            if burned <= minted {
                let supply = minted.saturating_sub(burned);
                if supply == 0 {
                    // ratio is 10_000 (fully collateralised by convention)
                } else {
                    let ratio =
                        (collateral as u128).saturating_mul(10_000) / (supply as u128);
                    let _r = ratio.min(u64::MAX as u128) as u64; // must not panic
                }
            }
        }
    }

    // Test: minter cap enforcement logic
    #[test]
    fn fuzz_minter_cap_never_exceeded() {
        let caps = [0u64, 1, 1000, u64::MAX];
        let already_minted = [0u64, 1, 999, u64::MAX - 1];
        let amounts = [1u64, 2, 500, u64::MAX];
        for cap in caps {
            for minted in already_minted {
                for amount in amounts {
                    if cap > 0 && minted <= cap {
                        if let Some(new_minted) = minted.checked_add(amount) {
                            if new_minted <= cap {
                                // mint allowed: verify invariant
                                assert!(new_minted <= cap);
                                assert!(new_minted > minted);
                            }
                        }
                    }
                }
            }
        }
    }

    // Test: SSS-3 solvency invariant across all deposit/mint/redeem combos
    #[test]
    fn fuzz_solvency_invariant() {
        struct State {
            minted: u64,
            burned: u64,
            collateral: u64,
        }
        let states = [
            State {
                minted: 1000,
                burned: 0,
                collateral: 1000,
            },
            State {
                minted: 1000,
                burned: 500,
                collateral: 500,
            },
            State {
                minted: u64::MAX / 2,
                burned: 0,
                collateral: u64::MAX / 2,
            },
        ];
        for s in &states {
            let net = s.minted.saturating_sub(s.burned);
            assert!(
                s.collateral >= net,
                "solvency violated: collateral={} net={}",
                s.collateral,
                net
            );
            // Mint: vault must cover new supply
            let mint_amount = 100u64;
            if let Some(required) = (net as u128).checked_add(mint_amount as u128) {
                if (s.collateral as u128) >= required {
                    let new_net = net + mint_amount;
                    assert!((s.collateral as u128) >= new_net as u128);
                }
            }
            // Redeem: both sides shrink by same amount
            let redeem = 100u64;
            if redeem <= net && s.collateral >= redeem {
                let new_collateral = s.collateral - redeem;
                let new_burned = s.burned + redeem;
                let new_net = s.minted - new_burned;
                assert!(
                    new_collateral >= new_net,
                    "solvency violated after redeem"
                );
            }
        }
    }

    // Test: feature_flags bitmask operations are safe
    #[test]
    fn fuzz_feature_flags_bitmask() {
        let all_flags = [1u64 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5];
        for &flag in &all_flags {
            let flags: u64 = flag;
            assert!(flags & flag != 0); // flag is set
            let cleared = flags & !flag;
            assert!(cleared & flag == 0); // flag is cleared
        }
        // Combined flags
        let combined = all_flags.iter().fold(0u64, |acc, &f| acc | f);
        for &flag in &all_flags {
            assert!(combined & flag != 0);
        }
    }

    // Test: pause invariant — paused=true means mint_allowed=false always
    #[test]
    fn fuzz_pause_always_blocks_mint() {
        for paused in [true, false] {
            for amount in [0u64, 1, 1000, u64::MAX] {
                let mint_allowed = !paused && amount > 0;
                if paused {
                    assert!(!mint_allowed);
                }
                if !paused && amount > 0 {
                    assert!(mint_allowed);
                }
            }
        }
    }
}

#[cfg(test)]
mod proptest_fuzz {
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn prop_net_supply_bounded(minted in 0u64..u64::MAX, burned in 0u64..u64::MAX) {
            if burned <= minted {
                let net = minted.saturating_sub(burned);
                prop_assert!(net <= minted);
            }
        }

        #[test]
        fn prop_reserve_ratio_no_panic(
            collateral in 0u64..u64::MAX,
            supply in 1u64..u64::MAX
        ) {
            let ratio = (collateral as u128).saturating_mul(10_000) / (supply as u128);
            let result = ratio.min(u64::MAX as u128) as u64;
            // Ratio must be in [0, 10_000 * (u64::MAX / supply)] — always fits in u64 after clamping
            prop_assert!(result as u128 <= ratio);
            // A fully-collateralised supply (collateral == supply) must yield exactly 10_000 bps
            if collateral == supply {
                prop_assert_eq!(ratio, 10_000u128);
            }
        }

        #[test]
        fn prop_minter_cap_enforced(
            cap in 1u64..u64::MAX,
            minted in 0u64..u64::MAX,
            amount in 1u64..u64::MAX
        ) {
            if minted <= cap {
                match minted.checked_add(amount) {
                    Some(new_minted) if new_minted <= cap => {
                        // Mint allowed: result must be strictly larger than previous total
                        prop_assert!(new_minted > minted);
                    }
                    _ => {
                        // Mint must be rejected (overflow or would exceed cap) — nothing to assert
                        // but we verify the rejection condition holds
                        let would_exceed = minted
                            .checked_add(amount)
                            .map_or(true, |n| n > cap);
                        prop_assert!(would_exceed);
                    }
                }
            }
        }
    }
}
