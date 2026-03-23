# LiteSVM Rust-Native Tests

Rust-native integration and fuzz tests for the SSS programs using [LiteSVM](https://github.com/LiteSVM/litesvm).

## What's Tested

### sss-core (7 tests)
- Invalid preset rejection
- Zero-amount mint rejection  
- Unauthorized grant_role rejection
- Randomized pause/unpause invariant fuzzing (50 iterations)
- Random discriminator fuzzing (100 iterations)
- Random account-count fuzzing per instruction
- Shadow-state invariant fuzzing (100 iterations)

### blacklist_hook (7 tests)
- Config initialization edge cases
- Blacklist-before-config rejection
- Pause-before-config rejection
- Transfer-admin-before-config rejection
- Random discriminator fuzzing (100 iterations)
- Randomized hook operation fuzzing (80 iterations)
- Random account-count fuzzing per instruction

## Running

```bash
# Prerequisite: build both programs first
cd programs/sss-core && anchor build
cd transfer_hooks/blacklist && anchor build

# Run tests
cd tests-litesvm
cargo test
```

## Architecture

Tests load compiled `.so` binaries directly into LiteSVM's in-process VM — no validator needed. This gives:
- Sub-second test execution (vs. minutes with solana-test-validator)
- True fuzzing with randomized inputs
- Panic-safety verification (random data must not crash programs)
