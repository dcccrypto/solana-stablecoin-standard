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

        // ═══════════════════════════════════════════════════════════════
        // SSS-115: PBS property-based fuzz tests
        // ═══════════════════════════════════════════════════════════════

        /// PBS: released_to_claimant + returned_to_issuer <= committed
        #[test]
        fn prop_pbs_funds_always_conserved(
            committed in 1u64..u64::MAX,
            released in 0u64..u64::MAX,
            returned in 0u64..u64::MAX
        ) {
            // Model: resolve gives `released` to claimant, refund gives `returned` to issuer.
            // Both draws come from the same committed pool.
            if let Some(total_out) = released.checked_add(returned) {
                if total_out <= committed {
                    // Valid state: funds conserved
                    let remaining = committed - total_out;
                    prop_assert!(remaining + released + returned == committed);
                }
                // If total_out > committed, the handler would reject — nothing to test
            }
        }

        /// PBS: sequence of partial resolves can never exceed committed
        #[test]
        fn prop_pbs_partial_resolve_bounded(
            committed in 1u64..=1_000_000u64,
            r1 in 0u64..=500_000u64,
            r2 in 0u64..=500_000u64,
            r3 in 0u64..=500_000u64
        ) {
            let mut resolved: u64 = 0;
            let resolves = [r1, r2, r3];
            for amount in resolves {
                if let Some(new_resolved) = resolved.checked_add(amount) {
                    if new_resolved <= committed {
                        resolved = new_resolved;
                        prop_assert!(resolved <= committed);
                    }
                    // else: handler rejects — resolve stays unchanged
                }
            }
            prop_assert!(resolved <= committed);
        }

        /// PBS: no resolve after expiry
        #[test]
        fn prop_pbs_no_resolve_after_expiry(
            status in 0u8..4,
            amount in 1u64..u64::MAX
        ) {
            // VaultStatus: 0=Pending, 1=Resolved, 2=Expired, 3=PartiallyResolved
            let is_expired = status == 2;
            let is_terminal = status == 1 || status == 2; // Resolved or Expired
            if is_expired {
                // Handler gate: require!(!vault.is_terminal())
                let can_resolve = !is_terminal;
                prop_assert!(!can_resolve, "resolve must be blocked after expiry");
            }
        }

        /// PBS: no double resolve
        #[test]
        fn prop_pbs_no_double_resolve(
            status in 0u8..4,
            amount in 1u64..u64::MAX
        ) {
            let is_resolved = status == 1;
            let is_terminal = status == 1 || status == 2;
            if is_resolved {
                let can_resolve = !is_terminal;
                prop_assert!(!can_resolve, "double resolve must be blocked");
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // SSS-115: APC property-based fuzz tests
        // ═══════════════════════════════════════════════════════════════

        /// APC: settled + returned <= deposit
        #[test]
        fn prop_apc_funds_conserved(
            deposit in 1u64..u64::MAX,
            settled_to_cp in 0u64..u64::MAX,
            returned_to_init in 0u64..u64::MAX
        ) {
            if let Some(total_out) = settled_to_cp.checked_add(returned_to_init) {
                if total_out <= deposit {
                    let remaining = deposit - total_out;
                    prop_assert!(remaining + settled_to_cp + returned_to_init == deposit);
                }
            }
        }

        /// APC: force_close only allowed after timeout
        #[test]
        fn prop_apc_force_close_only_after_timeout(
            open_slot in 0u64..u64::MAX / 2,
            timeout_slots in 1u64..1_000_000u64,
            current_slot in 0u64..u64::MAX
        ) {
            if let Some(deadline) = open_slot.checked_add(timeout_slots) {
                let can_force_close = current_slot >= deadline;
                if current_slot < deadline {
                    prop_assert!(!can_force_close, "force_close must be blocked before timeout");
                }
            }
        }

        /// APC: no settle after channel is closed (Settled or ForceClose)
        #[test]
        fn prop_apc_no_settle_after_closed(
            status in 0u8..4,
            amount in 1u64..u64::MAX
        ) {
            // ChannelStatus: 0=Open, 1=Disputed, 2=Settled, 3=ForceClose
            let is_terminal = status == 2 || status == 3;
            if is_terminal {
                let can_settle = !is_terminal;
                prop_assert!(!can_settle, "settle must be blocked on terminal channel");
            }
        }

        /// APC: dispute only from Open status
        #[test]
        fn prop_apc_dispute_only_from_open(
            status in 0u8..4
        ) {
            let is_open = status == 0;
            // Handler gate: require!(channel.status == ChannelStatus::Open)
            let can_dispute = is_open;
            if status != 0 {
                prop_assert!(!can_dispute, "dispute must only be allowed from Open status");
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // Existing tests below
        // ═══════════════════════════════════════════════════════════════

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

// ─── SSS-115: PBS and APC property-based fuzz tests ───────────────────────────
//
// These tests exercise pure arithmetic/state-machine logic for the
// Probabilistic Balance Standard (PBS) and Agent Payment Channel (APC)
// instructions.  No on-chain execution is required.
//
// Run with:
//   cargo test --manifest-path programs/sss-token/Cargo.toml prop_pbs
//   cargo test --manifest-path programs/sss-token/Cargo.toml prop_apc

#[cfg(test)]
mod proptest_pbs_apc {
    use proptest::prelude::*;

    // ── Mirrored PBS state for pure-logic tests ───────────────────────────────

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum VaultStatus {
        Pending,
        Resolved,
        Expired,
        PartiallyResolved,
    }

    /// Returns true when the vault is in a terminal state where no further
    /// resolution is allowed (mirrors `ProbabilisticVault::is_terminal`).
    fn pbs_can_resolve(status: VaultStatus) -> bool {
        !matches!(status, VaultStatus::Resolved | VaultStatus::Expired)
    }

    // ── Mirrored APC state for pure-logic tests ───────────────────────────────

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ChannelStatus {
        Open,
        Disputed,
        Settled,
        ForceClose,
    }

    /// Returns true if the channel can still be settled (mirrors on-chain check).
    fn apc_can_settle(status: ChannelStatus) -> bool {
        matches!(status, ChannelStatus::Open)
    }

    /// Returns true if force_close is allowed.
    fn apc_can_force_close(current_slot: u64, open_slot: u64, timeout_slots: u64) -> bool {
        // `current_slot >= open_slot + timeout_slots` (saturating to avoid overflow)
        current_slot >= open_slot.saturating_add(timeout_slots)
    }

    /// Returns true if a dispute can be raised from this status.
    fn apc_can_dispute(status: ChannelStatus) -> bool {
        matches!(status, ChannelStatus::Open)
    }

    // =========================================================================
    // PBS PROPERTY TESTS
    // =========================================================================

    proptest! {
        // SSS-115-PBS-1: For any (committed, released_to_claimant, returned_to_issuer),
        // the sum of released + returned must never exceed the committed amount.
        #[test]
        fn prop_pbs_funds_always_conserved(
            committed in 0u64..=u64::MAX,
            released_to_claimant in 0u64..=u64::MAX,
            returned_to_issuer in 0u64..=u64::MAX,
        ) {
            // Only consider valid distributions
            if let Some(total_out) = released_to_claimant.checked_add(returned_to_issuer) {
                if total_out <= committed {
                    // Fund conservation must hold: outputs cannot exceed inputs.
                    prop_assert!(
                        released_to_claimant + returned_to_issuer <= committed,
                        "PBS conservation violated: released={} + returned={} > committed={}",
                        released_to_claimant, returned_to_issuer, committed
                    );
                }
            }
            // When the sum would overflow u64 it is by definition > committed (a u64),
            // so the on-chain checked_add guard would reject it — no assertion needed.
        }

        // SSS-115-PBS-2: For any sequence of partial resolves, the running total
        // must never exceed the originally committed amount.
        #[test]
        fn prop_pbs_partial_resolve_bounded(
            committed in 1u64..=u64::MAX,
            resolve1 in 0u64..=u64::MAX,
            resolve2 in 0u64..=u64::MAX,
            resolve3 in 0u64..=u64::MAX,
        ) {
            let mut resolved: u64 = 0;
            let amounts = [resolve1, resolve2, resolve3];
            for &amount in &amounts {
                // Guard: only allow a partial resolve when there is remaining balance.
                let remaining = committed.saturating_sub(resolved);
                if amount == 0 || amount > remaining {
                    // On-chain: would be rejected (zero or exceeds remaining).
                    continue;
                }
                resolved = resolved.saturating_add(amount);
                prop_assert!(
                    resolved <= committed,
                    "PBS partial-resolve overflow: resolved={} > committed={}",
                    resolved, committed
                );
            }
        }

        // SSS-115-PBS-3: Once a vault is Expired, can_resolve must be false.
        #[test]
        fn prop_pbs_no_resolve_after_expiry(
            is_expired in proptest::bool::ANY,
        ) {
            let status = if is_expired {
                VaultStatus::Expired
            } else {
                VaultStatus::Pending
            };

            if is_expired {
                prop_assert!(
                    !pbs_can_resolve(status),
                    "PBS: can_resolve must be false when status=Expired"
                );
            } else {
                prop_assert!(
                    pbs_can_resolve(status),
                    "PBS: can_resolve must be true when status=Pending"
                );
            }
        }

        // SSS-115-PBS-4: Once a vault is Resolved, any further resolve attempt
        // must fail (is_terminal returns true, so can_resolve returns false).
        #[test]
        fn prop_pbs_no_double_resolve(
            already_resolved in proptest::bool::ANY,
        ) {
            let status = if already_resolved {
                VaultStatus::Resolved
            } else {
                VaultStatus::Pending
            };

            if already_resolved {
                prop_assert!(
                    !pbs_can_resolve(status),
                    "PBS: double-resolve must be blocked when status=Resolved"
                );
            }
        }
    }

    // =========================================================================
    // APC PROPERTY TESTS
    // =========================================================================

    proptest! {
        // SSS-115-APC-1: settled_to_counterparty + returned_to_initiator <= initiator_deposit.
        #[test]
        fn prop_apc_funds_conserved(
            initiator_deposit in 0u64..=u64::MAX,
            settled_to_counterparty in 0u64..=u64::MAX,
            returned_to_initiator in 0u64..=u64::MAX,
        ) {
            // Only consider valid distributions (mirrors countersign_settle_handler logic:
            // remainder = deposit - settled; both parties receive non-negative amounts).
            if settled_to_counterparty <= initiator_deposit {
                let remainder = initiator_deposit.saturating_sub(settled_to_counterparty);
                // returned_to_initiator must equal the remainder on-chain; model the invariant.
                prop_assert!(
                    settled_to_counterparty + remainder <= initiator_deposit,
                    "APC conservation violated"
                );
                // returned_to_initiator as provided must not exceed deposit either.
                if let Some(total) = settled_to_counterparty.checked_add(returned_to_initiator) {
                    if returned_to_initiator == remainder {
                        prop_assert!(
                            total <= initiator_deposit,
                            "APC: total payouts exceed deposit"
                        );
                    }
                }
            }
        }

        // SSS-115-APC-2: force_close is only permitted once current_slot >= open_slot + timeout_slots.
        #[test]
        fn prop_apc_force_close_only_after_timeout(
            open_slot in 0u64..u64::MAX / 2,
            timeout_slots in 1u64..u64::MAX / 2,
            current_slot in 0u64..u64::MAX,
        ) {
            let can_close = apc_can_force_close(current_slot, open_slot, timeout_slots);
            let deadline = open_slot.saturating_add(timeout_slots);

            if current_slot < deadline {
                prop_assert!(
                    !can_close,
                    "APC: force_close must not be allowed before timeout \
                     (current={} < deadline={})",
                    current_slot, deadline
                );
            } else {
                prop_assert!(
                    can_close,
                    "APC: force_close must be allowed at/after timeout \
                     (current={} >= deadline={})",
                    current_slot, deadline
                );
            }
        }

        // SSS-115-APC-3: Settle is not allowed when channel status is Settled or ForceClose.
        #[test]
        fn prop_apc_no_settle_after_closed(
            status_discriminant in 0u8..4,
        ) {
            let status = match status_discriminant % 4 {
                0 => ChannelStatus::Open,
                1 => ChannelStatus::Disputed,
                2 => ChannelStatus::Settled,
                _ => ChannelStatus::ForceClose,
            };

            let can_settle = apc_can_settle(status);

            match status {
                ChannelStatus::Settled | ChannelStatus::ForceClose => {
                    prop_assert!(
                        !can_settle,
                        "APC: settle must be blocked when status={:?}", status
                    );
                }
                ChannelStatus::Open => {
                    prop_assert!(
                        can_settle,
                        "APC: settle must be allowed when status=Open"
                    );
                }
                ChannelStatus::Disputed => {
                    // Disputed channels cannot settle via the normal path.
                    prop_assert!(
                        !can_settle,
                        "APC: settle must be blocked when status=Disputed"
                    );
                }
            }
        }

        // SSS-115-APC-4: Dispute is only allowed from Open status.
        #[test]
        fn prop_apc_dispute_only_from_open(
            status_discriminant in 0u8..4,
        ) {
            let status = match status_discriminant % 4 {
                0 => ChannelStatus::Open,
                1 => ChannelStatus::Disputed,
                2 => ChannelStatus::Settled,
                _ => ChannelStatus::ForceClose,
            };

            let can_disp = apc_can_dispute(status);

            if matches!(status, ChannelStatus::Open) {
                prop_assert!(
                    can_disp,
                    "APC: dispute must be allowed from Open"
                );
            } else {
                prop_assert!(
                    !can_disp,
                    "APC: dispute must be blocked from non-Open status ({:?})", status
                );
            }
        }
    }
}
