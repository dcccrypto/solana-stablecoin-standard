# SSS — Formal Verification Reference

> **Tool:** [Kani Rust Verifier](https://github.com/model-checking/kani)
> **Source:** `programs/sss-token/src/proofs.rs`
> **Status:** 75/75 proofs verified, 0 failures — all 75 are properly inductive (SSS-108, SSS-117, BUG-029, BUG-030)

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

# Run all 75 harnesses (all are inductive — no tautological proofs remain as of SSS-117)
cargo kani

# Run a specific harness
cargo kani --harness proof_sss3_mint_solvency_inductive

# Expected output:
# VERIFICATION:- SUCCESSFUL
# Complete - 75 successfully verified harnesses, 0 failures
# All 75 are properly inductive — 17 tautological/vacuous proofs rewritten in SSS-117
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

These proofs cover the core SSS-3 (Trustless Collateral-Backed) guarantee: collateral ≥ net supply at all times.

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

## Proof Quality Audit — SSS-117 (2026-03-22)

An internal audit of all 35 proofs (commit `c0a744b`) found 17 that were tautological, vacuous, or weak. All 17 were rewritten to proper inductive form. Categories fixed:

| Category | Count | Example | Fix applied |
|----------|-------|---------|-------------|
| Tautological (`assert!(X)` inside `if X {}`) | 13 | `proof_net_supply_bounded_by_max` | Assert the **consequence**, not the guard |
| Vacuous (`assert!` inside `if let Some` with no overflow assume) | 2 | `proof_total_minted_monotonic` | Added `kani::assume(total_minted <= u64::MAX - amount)` |
| Weak (trivially true, not ratio improvement) | 2 | `proof_deposit_improves_reserve_ratio` | Assert ratio inequality using u128 arithmetic |

Proofs that were already strong and untouched: `proof_sss3_mint_solvency_inductive`, `proof_sss3_redeem_preserves_solvency`, `proof_cdp_collateral_ratio_inductive`, `proof_dao_quorum_enforced`, `proof_dao_member_dedup`, `proof_authority_two_step_inductive`, `proof_authority_accept_clears_pending`, `proof_blacklist_pda_no_collision`, `proof_feature_flags_set_clear_inverse`, `proof_feature_flag_bit_isolation`, `proof_backstop_never_overdraws_fund`, and PBS/APC proofs.

---

## Section 17: On-Chain State Transitions (BUG-030)

Added 20 proofs in commit `a385b9a`, bringing the total from 55 to 75. All use symbolic structs (not raw `u64`s) to verify handler behaviour at the struct level.

### Section 17-A: Config-Struct State Transitions (5 proofs)

These proofs verify that each handler mutates **only the intended field** of `StablecoinConfig` — stray writes to unrelated fields (e.g. a mint path accidentally clearing `paused`) are impossible.

| Harness | Mutation Proved Isolated |
|---------|--------------------------|
| `proof_mint_mutates_only_total_minted` | `mint_handler` writes only `total_minted` |
| `proof_burn_mutates_only_total_burned` | `burn_handler` writes only `total_burned`; net supply decreases |
| `proof_pause_mutates_only_paused_field` | `set_paused(true)` writes only `paused`; other fields unchanged |
| `proof_accept_authority_mutates_only_authority_fields` | `accept_authority` writes only `authority` + `pending_authority` |
| `proof_set_feature_flag_mutates_only_flags` | `set_feature_flag` writes only `feature_flags`; no other fields touched |

### Section 17-B: PDA Seed Collision-Resistance (5 proofs)

Proves that each PDA type produces distinct addresses for distinct inputs — no two different accounts can share the same PDA.

| Harness | PDA Type |
|---------|----------|
| `proof_stablecoin_config_pda_no_collision` | `StablecoinConfig` (per-mint singleton) |
| `proof_minter_info_pda_no_collision` | `MinterInfo` per minter key |
| `proof_cdp_position_pda_no_collision` | `CdpPosition` per (user, collateral mint) |
| `proof_dao_committee_pda_no_collision` | `DaoCommittee` per committee ID |
| `proof_dao_proposal_pda_no_collision` | `DaoProposal` per (committee, proposal index) |

### Section 17-C: Adversarial AUDIT-C Scenarios (10 proofs)

Formal proofs for the 10 highest-priority AUDIT-C adversarial scenarios — attacks that are difficult to cover exhaustively with unit tests.

| Harness | Attack Blocked |
|---------|---------------|
| `proof_spoofed_signer_rejected_on_mint` | Signer spoofing — wrong key cannot mint |
| `proof_supply_cap_cannot_be_bypassed_by_sequential_mints` | Sequential cap race — two sequential mints cannot together exceed the cap |
| `proof_pause_blocks_burn_as_well_as_mint` | Pause bypass via burn path — `paused = true` blocks burns too |
| `proof_timelock_shortcut_rejected_before_mature` | Timelock skip — execution before `mature_slot` is unconditionally rejected |
| `proof_double_mint_blocked_by_cap_state` | Concurrent double-mint — state serialization prevents cap bypass |
| `proof_zero_amount_mint_unconditionally_rejected` | Zero-amount probe — `amount = 0` always rejects |
| `proof_cdp_overborrow_rejected_on_price_overflow` | Oracle price overflow → overborrow — saturating arithmetic prevents it |
| `proof_liquidation_front_run_impossible` | Front-run with stale Pyth price — stale-price guard fires before liquidation math |
| `proof_old_authority_cannot_act_after_transfer` | Post-transfer authority race — old key rejected after `accept_authority` |
| `proof_feature_flag_race_order_independent` | Concurrent flag set/clear — result is always a valid flag state |

> **Total after BUG-030:** 75 proofs (was 55). All 20 new proofs use symbolic structs and `kani::any()` inputs — no hardcoded concrete values.

---

## Adding New Proofs

Per `CONTRIBUTING.md`: all new instructions must have corresponding Kani proofs in `proofs.rs`. A valid proof must:

1. Use `kani::assume()` to state all preconditions (valid program states only)
2. Use `assert!()` for real postconditions — **never assert X inside an `if X {}` block** (tautology)
3. Be inductive: invariant holds before → proved it holds after
4. Use `kani::any()` for all inputs — **never hardcode concrete values** (unit test, not proof)
5. Use `kani::cover!(true)` in every conditional branch to prove non-vacuity
6. Include a doc comment with **WHAT**, **WHY**, and **HOW** it is inductive

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
