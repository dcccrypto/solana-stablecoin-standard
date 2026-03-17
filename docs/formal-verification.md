# SSS — Formal Verification Reference

> **Tool:** [Kani Rust Verifier](https://github.com/model-checking/kani)
> **Source:** `programs/sss-token/src/proofs.rs`
> **Status:** 35/35 proofs verified, 0 failures (SSS-108)

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

Every proof in `proofs.rs` is **inductive**:
- Preconditions establish a valid program state (`kani::assume()`)
- The postcondition proves the invariant holds after the transition (`assert!()`)
- This means the invariant is preserved across all reachable state transitions, not just at initialization

---

## Running the Proofs

```bash
cd programs/sss-token

# Run all 35 harnesses
cargo kani

# Run a specific harness
cargo kani --harness proof_sss3_mint_solvency_inductive

# Expected output:
# VERIFICATION:- SUCCESSFUL
# Complete - 35 successfully verified harnesses, 0 failures
```

**Requirements:**

```bash
# Install Kani (one-time)
cargo install --locked kani-verifier
cargo kani setup
```

> **Note:** Kani requires a nightly Rust toolchain and the `kani-verifier` cargo extension. It is separate from the standard `anchor test` CI job. The proof file is compiled only under `#[cfg(kani)]` — zero impact on the production binary.

---

## Proof Coverage by Domain

### Section 1: Arithmetic Safety (3 proofs)

| Harness | Invariant | Attack Blocked |
|---------|-----------|----------------|
| `proof_u64_checked_add_no_overflow` | `checked_add` never silently wraps | Integer overflow → unbounded mint |
| `proof_u64_checked_sub_no_underflow` | `checked_sub` never silently underflows | Underflow in net-supply computation |
| `proof_u128_reserve_ratio_nonzero` | Reserve-ratio numerator never truncates to 0 | Zero-ratio bypass of solvency check |

---

### Section 2: Net Supply Invariants (5 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_total_minted_monotonic` | `total_minted` strictly increases on every mint |
| `proof_total_burned_monotonic` | `total_burned` strictly increases on every burn |
| `proof_net_supply_nonnegative` | Net supply (`minted - burned`) is always ≥ 0 |
| `proof_total_minted_never_decreases` | `total_minted` never decreases across any state transition |
| `proof_net_supply_bounded_by_max` | Net supply is bounded by `max_supply` when it is set |

---

### Section 3: Minter Cap (2 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_minter_cap_inductive` | Per-minter cap is inductively enforced after every mint |
| `proof_unlimited_cap_never_blocks` | `cap == 0` (unlimited) never incorrectly rejects a mint |

---

### Section 4: SSS-3 Solvency (4 proofs)

These proofs cover the core SSS-3 (Trustless Collateral-Backed) guarantee: collateral ≥ net supply at all times.

| Harness | Invariant |
|---------|-----------|
| `proof_sss3_mint_solvency_inductive` | After a successful mint: `collateral ≥ new_net_supply` |
| `proof_sss3_redeem_preserves_solvency` | After a redeem: `collateral ≥ new_net_supply` |
| `proof_deposit_improves_reserve_ratio` | Depositing collateral without minting strictly improves the reserve ratio |
| `proof_reserve_ratio_exact_at_parity` | When `collateral == net_supply`, ratio equals exactly 10 000 bps (100%) |

---

### Section 5: CDP Module (4 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_cdp_borrow_enforces_ltv` | `cdp_borrow_stable` enforces MIN_COLLATERAL_RATIO_BPS (150%) post-borrow |
| `proof_cdp_collateral_ratio_inductive` | Collateral ratio ≥ MIN before deposit → ≥ MIN after |
| `proof_cdp_liquidation_only_when_undercollateralised` | Liquidation can only occur when collateral ratio < LIQUIDATION_THRESHOLD (120%) |
| `proof_cdp_repay_decreases_debt` | Repaying debt strictly decreases `debt_amount` |

---

### Section 6: Pause Circuit Breaker (2 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_pause_inductive_blocks_all_mints` | `paused == true` inductively blocks all mints for all inputs |
| `proof_pause_idempotent` | Pausing an already-paused state leaves `paused = true` |

---

### Section 7: Timelock (3 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_timelock_delay_enforced` | `propose_timelocked_op` sets `mature_slot = current_slot + delay` |
| `proof_timelock_cancel_clears_pending` | `cancel_timelocked_op` clears pending op (`admin_op_kind → NONE`) |
| `proof_timelock_no_double_execute` | `execute_timelocked_op` cannot run the same op twice |

---

### Section 8: DAO Committee (3 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_dao_quorum_enforced` | A proposal can only execute when `votes.len() ≥ quorum` |
| `proof_dao_no_double_vote` | A committee member cannot vote twice on the same proposal |
| `proof_dao_member_dedup` | Duplicate members are rejected during committee initialisation |

---

### Section 9: Authority Transfer (2 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_authority_two_step_inductive` | Two-step transfer is inductive — accept sets authority to pending |
| `proof_authority_accept_clears_pending` | After `accept_authority`, `pending_authority` is cleared to default |

---

### Section 10: Blacklist PDA (2 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_blacklist_pda_deterministic` | Same `(mint, wallet)` always produces the same PDA seeds |
| `proof_blacklist_pda_no_collision` | Two distinct `(mint, wallet)` pairs produce distinct PDA seeds |

---

### Section 11: Feature Flags (2 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_feature_flags_set_clear_inverse` | `set_feature_flag` and `clear_feature_flag` are exact inverses |
| `proof_feature_flag_bit_isolation` | Setting FLAG_A does not affect any other bit (FLAG_B) |

---

### Section 12: PSM / Fees (2 proofs)

| Harness | Invariant |
|---------|-----------|
| `proof_psm_fee_bounded` | PSM redemption fee is always in [0, 1000] bps (max 10%) |
| `proof_stability_fee_bounded` | Annual stability fee is bounded [0, 10 000] bps (max 100% APR) |

---

### Section 13: Backstop (1 proof)

| Harness | Invariant |
|---------|-----------|
| `proof_backstop_never_overdraws_fund` | `bad_debt_backstop` never draws more than `min(fund_balance, max_allowed)` |

---

## Adding New Proofs

Per `CONTRIBUTING.md`: all new instructions must have corresponding Kani proofs in `proofs.rs`. A valid proof must:

1. Use `kani::assume()` to state all preconditions (valid program states only)
2. Use `assert!()` for real postconditions — not tautologies
3. Be inductive: invariant holds before → proved it holds after
4. Include a doc comment with **WHAT**, **WHY**, and **HOW** it is inductive

```rust
/// WHAT: <what invariant is proved>
/// WHY:  <why this invariant matters for SSS security>
/// HOW:  <how the inductive argument works>
#[kani::proof]
fn proof_your_new_invariant() {
    let x: u64 = kani::any();
    kani::assume(/* valid precondition */);
    // ... perform the state transition ...
    assert!(/* postcondition */);
}
```

---

## Related Docs

- [SSS-1.md](./SSS-1.md) — SSS-1 (Minimal) preset specification
- [SSS-2.md](./SSS-2.md) — SSS-2 (Compliant) preset specification
- [SSS-3.md](./SSS-3.md) — SSS-3 (Trustless Collateral-Backed) specification
- [ARCHITECTURE.md](./ARCHITECTURE.md) — three-layer architecture reference
- [FUZZING.md](./FUZZING.md) — Trident fuzz testing suite (SSS-105)
- [anchor-program-testing.md](./anchor-program-testing.md) — Anchor unit/integration tests
- [SECURITY.md](./SECURITY.md) — Security model and audit log
