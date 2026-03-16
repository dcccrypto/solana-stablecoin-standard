# Fuzz Testing — Solana Stablecoin Standard

The SSS program includes property-based fuzz tests in `programs/sss-token/src/fuzz_tests.rs`.

## What is Tested

| Harness | Invariant Verified |
|---------|-------------------|
| `fuzz_net_supply_no_underflow` | net_supply() never underflows for any minted/burned combo |
| `fuzz_reserve_ratio_bps_no_panic` | reserve_ratio_bps() never panics at any u64 value |
| `fuzz_minter_cap_never_exceeded` | Minter cap is always respected after mint |
| `fuzz_solvency_invariant` | Vault >= net supply before/after mint and redeem |
| `fuzz_feature_flags_bitmask` | Bitmask set/clear operations are correct |
| `fuzz_pause_always_blocks_mint` | Paused=true always prevents minting |

## Running

```bash
cargo test --manifest-path programs/sss-token/Cargo.toml fuzz
cargo test --manifest-path programs/sss-token/Cargo.toml proptest
```

## Framework

Property-based tests use [proptest](https://github.com/proptest-rs/proptest) for randomized input generation.
For full on-chain instruction fuzzing with [Trident](https://github.com/Ackee-Blockchain/trident), install `trident-cli` and run `trident fuzz run`.
