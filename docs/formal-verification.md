# SSS — Formal Verification Reference

> **Tool:** [Kani Rust Verifier](https://github.com/model-checking/kani)
> **Source:** `programs/sss-token/src/proofs.rs`
> **Status:** 7/7 proofs verified, 0 failures

---

## Overview

The Solana Stablecoin Standard uses **Kani** to formally verify critical invariants of the stablecoin state machine. Formal verification is distinct from testing:

| | Unit Tests | Formal Proofs |
|--|-----------|--------------|
| Coverage | Specific inputs you write | **All possible inputs** |
| Pass/fail | Can miss edge cases | Mathematically exhaustive |
| Counterexamples | None shown on pass | Shows the exact failing input if violated |
| Build time | Fast | Seconds–minutes per harness |

Kani uses **bounded model checking** (CBMC backend) to exhaustively explore all reachable states of a Rust function. If a proof harness contains an `assert!()` that can be violated by *any* input satisfying the `kani::assume()` preconditions, Kani reports a counterexample and the verification fails.

---

## Running the Proofs

```bash
cd programs/sss-token

# Run all 7 harnesses
cargo kani

# Run a specific harness
cargo kani --harness proof_sss3_reserve_invariant

# Expected output:
# VERIFICATION:- SUCCESSFUL
# Complete - 7 successfully verified harnesses, 0 failures
```

**Requirements:**

```bash
# Install Kani (one-time)
cargo install --locked kani-verifier
cargo kani setup
```

---

## Verified Invariants

### 1. `proof_checked_add_no_overflow`

**Invariant:** `checked_add` on `u64` never silently overflows.

```rust
let a: u64 = kani::any();
let b: u64 = kani::any();

match a.checked_add(b) {
    Some(result) => {
        assert!(result == a.wrapping_add(b));
        assert!(result >= a); // no overflow
        assert!(result >= b);
    }
    None => {
        // Sum would have overflowed
        assert!(a.wrapping_add(b) < a || a.wrapping_add(b) < b);
    }
}
```

**Why it matters:** Every mint and burn in the SSS program uses `checked_add`/`checked_sub` for token arithmetic. This proof guarantees that for *any* two `u64` values, the overflow path is always correctly detected and never silently wraps.

---

### 2. `proof_minter_cap_invariant`

**Invariant:** The minter cap is always respected — `minted' ≤ cap` after any successful mint.

```
Preconditions: already_minted ≤ cap, amount > 0
Proof: if checked_add(already_minted, amount) ≤ cap → new_minted ≤ cap
```

**Why it matters:** Each registered minter has an individual cap (`MinterInfo.cap`). This proof guarantees that no combination of valid inputs can cause `total_minted` to exceed the assigned cap. The only bypass is `MinterCapExceeded` — the intended error.

---

### 3. `proof_total_minted_monotonic`

**Invariant:** `total_minted` is monotonically non-decreasing — it never decreases.

```
Precondition: amount > 0
Proof: checked_add(total_minted, amount) > total_minted (strictly increases)
```

**Why it matters:** `total_minted` is used alongside `total_burned` to compute net supply. If it could decrease, net supply calculations would become unreliable. This proof guarantees the counter only ever goes up.

---

### 4. `proof_burn_bounded_by_minted`

**Invariant:** `total_burned` can never exceed `total_minted`.

```
Preconditions: total_burned ≤ total_minted, amount ≤ net_supply, amount > 0
Proof: checked_add(total_burned, amount) ≤ total_minted
```

**Why it matters:** If `total_burned` could exceed `total_minted`, the net supply calculation `total_minted - total_burned` would underflow (panic in release mode). This proof guarantees the burn invariant holds for all reachable states.

---

### 5. `proof_preset_validation`

**Invariant:** Only preset values `1`, `2`, and `3` are valid; all others are rejected.

```
For any u8 preset:
  preset ∈ {1, 2, 3} ↔ is_valid = true
  preset ∉ {1, 2, 3} ↔ is_valid = false (InvalidPreset)
```

**Why it matters:** Preset selection determines which extensions are enabled at mint initialization (Token-2022 extensions differ per preset). An invalid preset value would produce an incorrectly configured mint. This proof covers all 256 possible `u8` values exhaustively.

---

### 6. `proof_pause_blocks_mint`

**Invariant:** When `paused = true`, no mint can succeed.

```
For any (paused: bool, amount: u64) where amount > 0:
  paused = true  → mint cannot proceed (would_mint = false)
  paused = false → mint may proceed (could_mint = true)
```

**Why it matters:** The pause mechanism is the emergency circuit breaker for the SSS-1 and SSS-2 presets. This proof guarantees there is no combination of inputs where `paused = true` and a mint proceeds — the logic is provably correct, not just tested for common cases.

---

### 7. `proof_sss3_reserve_invariant`

**Invariant:** For SSS-3 (Trustless Collateral-Backed), vault balance is always ≥ net supply after a successful mint.

```
Preconditions: total_burned ≤ total_minted, amount > 0
SSS-3 check: vault_balance ≥ net_supply + amount
Proof: if check passes → vault_balance ≥ new_net_supply
```

**Why it matters:** This is the core SSS-3 guarantee — no mint can succeed unless the collateral vault holds enough to cover the increased supply. For *any* combination of vault balance, total minted, total burned, and mint amount, the collateral ratio is maintained. This is a trustless reserve proof.

---

## Proof File Location

```
programs/sss-token/src/proofs.rs
```

The file is compiled only under `#[cfg(kani)]` — zero impact on the production binary size or runtime.

---

## CI Integration

Kani verification runs are intended to be added to CI as a pre-merge check on the `main` branch. Until then, run `cargo kani` locally before any PR touching `programs/sss-token/src/lib.rs` or `programs/sss-token/src/state.rs`.

> **Note:** Kani requires a nightly Rust toolchain and the `kani-verifier` cargo extension. It is separate from the standard `anchor test` CI job. See the [Kani docs](https://model-checking.github.io/kani/) for installation details.

---

## Related Docs

- [SSS-1.md](./SSS-1.md) — SSS-1 (Minimal) preset specification
- [SSS-2.md](./SSS-2.md) — SSS-2 (Compliant) preset specification
- [SSS-3.md](./SSS-3.md) — SSS-3 (Trustless Collateral-Backed) specification
- [ARCHITECTURE.md](./ARCHITECTURE.md) — three-layer architecture reference
- [anchor-program-testing.md](./anchor-program-testing.md) — Anchor unit/integration tests (13/13)
