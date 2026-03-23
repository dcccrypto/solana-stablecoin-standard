# Fuzz Testing — Solana Stablecoin Standard

The SSS program includes property-based fuzz tests in `programs/sss-token/src/fuzz_tests.rs`.

## What is Tested

### Core Invariants (6 harnesses — SSS-105)

| Harness | Invariant Verified |
|---------|-------------------|
| `fuzz_net_supply_no_underflow` | net_supply() never underflows for any minted/burned combo |
| `fuzz_reserve_ratio_bps_no_panic` | reserve_ratio_bps() never panics at any u64 value |
| `fuzz_minter_cap_never_exceeded` | Minter cap is always respected after mint |
| `fuzz_solvency_invariant` | Vault >= net supply before/after mint and redeem |
| `fuzz_feature_flags_bitmask` | Bitmask set/clear operations are correct |
| `fuzz_pause_always_blocks_mint` | Paused=true always prevents minting |

### PBS (Probabilistic Bilateral Settlement) — 4 harnesses (SSS-115)

| Harness | Invariant Verified |
|---------|-------------------|
| `prop_pbs_funds_always_conserved` | `released_to_claimant + returned_to_issuer <= committed` for any amounts |
| `prop_pbs_partial_resolve_bounded` | Partial resolve amount never exceeds remaining balance; sequential partials total ≤ committed |
| `prop_pbs_no_resolve_after_expiry` | If `status == Expired`, prove_and_resolve must fail (`!can_resolve`) |
| `prop_pbs_no_double_resolve` | If `status == Resolved`, any further operation must fail |

### APC (Agent Payment Channel) — 4 harnesses (SSS-115)

| Harness | Invariant Verified |
|---------|-------------------|
| `prop_apc_funds_conserved` | `settled_to_counterparty + returned_to_initiator <= initiator_deposit` |
| `prop_apc_force_close_only_after_timeout` | force_close blocked if `current_slot < open_slot + timeout_slots` |
| `prop_apc_no_settle_after_closed` | If `status == Settled` or `ForceClose`, settle must fail |
| `prop_apc_dispute_only_from_open` | dispute can only be called from Open status |

## Running

```bash
# Run all fuzz/proptest harnesses
cargo test --manifest-path programs/sss-token/Cargo.toml fuzz
cargo test --manifest-path programs/sss-token/Cargo.toml proptest

# Run PBS/APC property tests specifically
cargo test --manifest-path programs/sss-token/Cargo.toml prop_pbs
cargo test --manifest-path programs/sss-token/Cargo.toml prop_apc
```

## Framework

Property-based tests use [proptest](https://github.com/proptest-rs/proptest) for randomized input generation.
For full on-chain instruction fuzzing with [Trident](https://github.com/Ackee-Blockchain/trident), install `trident-cli` and run `trident fuzz run`.

## Related Docs

- [formal-verification.md](./formal-verification.md) — Kani model checking (35 proof harnesses)
- [anchor-program-testing.md](./anchor-program-testing.md) — Anchor unit/integration tests
- [SECURITY.md](./SECURITY.md) — Security model and audit log
