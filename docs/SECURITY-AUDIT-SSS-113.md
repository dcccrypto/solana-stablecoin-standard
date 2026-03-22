# Security Audit — SSS-113

**Program:** `programs/sss-token/src/`  
**Audit Date:** 2026-03-22  
**Auditor:** sss-anchor (automated + code review)  
**Scope:** All Anchor instruction handlers, account constraints, state transitions, CPI paths, PBS, APC, CDP, DAO, and timelock subsystems.  
**Branch:** `feat/sss-113-security-audit`

---

## Executive Summary

The SSS Anchor program is a feature-rich stablecoin standard covering Token-2022 minting (SSS-1/2/3), collateralized debt positions, probabilistic balance standard, agent payment channels, DAO governance, and an admin timelock.  The codebase demonstrates strong security awareness in many areas (proper PDA seeds, checked arithmetic throughout, circuit breaker, Pyth feed validation, signer checks), but the audit identified **1 CRITICAL**, **5 HIGH**, **4 MEDIUM**, **3 LOW**, and **3 INFO** findings.

All CRITICAL and HIGH findings have been remediated in this branch.

---

## Checklist Categories

| # | Category | Status |
|---|---|---|
| 1 | Signer / authority checks | Findings |
| 2 | PDA validation & account confusion | Findings |
| 3 | Arithmetic (overflow/underflow) | Low findings only |
| 4 | CPI safety | Findings |
| 5 | PBS-specific checks | Low |
| 6 | APC-specific checks | Medium |
| 7 | CDP-specific checks | Findings |
| 8 | DAO governance checks | Info |
| 9 | Admin timelock checks | Critical |
| 10 | Oracle / price feed checks | Low |

---

## CRITICAL

### CRIT-01 — `update_roles` Bypasses Admin Timelock for Authority Transfer

**Instruction:** `update_roles`  
**File/Line:** `programs/sss-token/src/instructions/update_roles.rs:28–37`

**Description:**  
`update_roles` directly sets `config.pending_authority` to any provided `new_authority` without applying the admin timelock delay. The protocol added a separate timelock mechanism (`propose_timelocked_op` / `execute_timelocked_op`) to enforce a 2-epoch (~2-day) delay before authority can be transferred. However, `update_roles` remains fully functional and entirely circumvents the timelock, making the security guarantee illusory.

**Exploitability:**  
A compromised authority key can call `update_roles { new_authority: attacker }` → `accept_authority`, transferring full protocol control instantly without waiting the ~2-day timelock delay. This bypasses the primary safeguard against a leaked or stolen authority key. The timelock documentation explicitly calls this out as protecting against "a compromised key from instantly draining the protocol."

**Fix:**  
When `admin_timelock_delay > 0`, reject direct authority transfers via `update_roles` and require the timelock path (`propose_timelocked_op`). A new error `UseTimelockForAuthorityTransfer` was added. Compliance authority transfers continue to use the two-step mechanism since there is no timelock variant for that role.

**Status:** ✅ Fixed in this PR.

---

## HIGH

### HIGH-01 — `burn` Instruction Missing `FLAG_CIRCUIT_BREAKER` Check

**Instruction:** `burn`  
**File/Line:** `programs/sss-token/src/instructions/burn.rs:28–48`

**Description:**  
The `burn` instruction only checks `config.paused` but does **not** check `FLAG_CIRCUIT_BREAKER`. The circuit breaker is documented as "halt all mint/transfer/burn ops." `mint` (line 13) and `cdp_borrow_stable` both check the circuit breaker, creating an inconsistent security surface. `burn` can proceed even when the circuit breaker is active.

**Exploitability:**  
During a circuit breaker event (e.g., oracle manipulation, unexpected mint behavior), a registered minter can still call `burn`. In isolation this is less dangerous than minting, but it undermines the "full halt" guarantee and could interact with other exploits. The same gap exists in `cpi_burn` (see HIGH-02).

**Fix:**  
Added `FLAG_CIRCUIT_BREAKER` check to `burn.rs` handler.  
**Status:** ✅ Fixed in this PR.

---

### HIGH-02 — `cpi_mint` and `cpi_burn` Missing `FLAG_CIRCUIT_BREAKER` and Epoch Velocity Checks

**Instruction:** `cpi_mint`, `cpi_burn`  
**File/Line:** `programs/sss-token/src/instructions/cpi_mint.rs:62`, `cpi_burn.rs:53`

**Description:**  
`cpi_mint` checks `!config.paused` but omits:
1. `FLAG_CIRCUIT_BREAKER` check — allows minting even during emergency halt.
2. Epoch velocity limit check — allows unlimited minting per epoch via the CPI path, bypassing the rate limit that exists in `mint`.

`cpi_burn` checks `!config.paused` but omits the `FLAG_CIRCUIT_BREAKER` check.

**Exploitability:**  
Any registered minter can call `cpi_mint` to bypass both the circuit breaker and the per-minter velocity limit. This is a direct bypass of two security controls via the CPI composability entrypoint. A malicious minter could flood the supply during a halted protocol state.

**Fix:**  
Added `FLAG_CIRCUIT_BREAKER` check to both handlers. Added epoch velocity limit check to `cpi_mint`.  
**Status:** ✅ Fixed in this PR.

---

### HIGH-03 — `trigger_backstop` Is Unreachable by Design Flaw

**Instruction:** `trigger_backstop`  
**File/Line:** `programs/sss-token/src/instructions/bad_debt_backstop.rs:55–112`

**Description:**  
The backstop instruction requires `liquidation_authority: Signer<'info>` to equal `config.key()` — the config PDA. A PDA can only sign via CPI from within the program that owns it. However, `cdp_liquidate` and `cdp_liquidate_v2` never invoke `trigger_backstop` via CPI. The constraint is therefore impossible to satisfy from any external caller, and the liquidation handlers never provide a path to satisfy it internally. The entire bad-debt backstop mechanism (SSS-097) is non-functional.

**Exploitability:**  
No actual exploit — the instruction simply never executes. However, the backstop is a critical safety feature that absorbs bad debt after undercollateralized liquidations. With it non-functional, any liquidation that results in collateral < debt leaves permanent bad debt with no recovery mechanism.

**Fix:**  
Changed the constraint to allow the config `authority` to manually trigger the backstop. This makes the backstop usable as an authority-controlled manual intervention tool for bad-debt recovery after verified liquidation shortfalls.  
**Status:** ✅ Fixed in this PR.

---

### HIGH-04 — `cdp_deposit_collateral` Missing `sss_mint` Validation on Optional `yield_collateral_config`

**Instruction:** `cdp_deposit_collateral`  
**File/Line:** `programs/sss-token/src/instructions/cdp_deposit_collateral.rs:92–104`

**Description:**  
When `FLAG_YIELD_COLLATERAL` is set, the handler checks that `collateral_mint` exists in `yield_collateral_config.whitelisted_mints` but does **not** verify that `yc_config.sss_mint == sss_mint.key()`. The optional `yield_collateral_config` account has no PDA seed constraints in the Accounts struct, so an attacker can pass the `YieldCollateralConfig` PDA from a *different* stablecoin that has the desired collateral mint in its whitelist, bypassing the restriction.

**Exploitability:**  
An attacker who controls a second SSS-3 stablecoin can whitelist an arbitrary SPL token in that stablecoin's `YieldCollateralConfig`, then pass that PDA to `cdp_deposit_collateral` for the target stablecoin where the token is not whitelisted. This deposits an unintended collateral type into the CDP, potentially bypassing yield-collateral quality controls (e.g., depositing a low-value token as collateral for a stablecoin that only intends to accept high-quality tokens like stSOL, mSOL).

**Fix:**  
Added `require!(yc_config.sss_mint == ctx.accounts.sss_mint.key(), SssError::InvalidCollateralMint)` before the whitelist check.  
**Status:** ✅ Fixed in this PR.

---

### HIGH-05 — `accrued_fees` Not Included in CDP Debt Calculations

**Instruction:** `cdp_borrow_stable`, `cdp_liquidate`, `cdp_liquidate_v2`  
**File/Lines:**
- `cdp_borrow_stable.rs:93` — uses only `position.debt_amount` 
- `cdp_liquidate.rs:125` — `let debt = ctx.accounts.cdp_position.debt_amount`
- `cdp_liquidate_v2.rs:134` — `let total_debt = ctx.accounts.cdp_position.debt_amount`

**Description:**  
Stability fees accrue into `CdpPosition.accrued_fees` but all debt calculations (collateral ratio, liquidation check, max borrow) use only `debt_amount`. This creates three sub-issues:
1. **Over-borrowing:** A borrower can borrow up to the 150% ratio limit, then accrue fees that push them above the limit with no enforcement.
2. **Incorrect liquidation threshold:** A position may appear healthy by `debt_amount` alone, even though `debt_amount + accrued_fees` exceeds the safe ratio.
3. **Fee loss on liquidation:** When a position is liquidated, `accrued_fees` is ignored — the protocol loses fee revenue.

**Exploitability:**  
A borrower intentionally borrows the maximum allowed and allows fees to accrue, creating a position that is undercollateralized by the true debt metric. The fee accumulation is slow (max 20% p.a.) but over time or with high fee configurations, this creates systemic undercollateralization. Liquidators receive all debt + accrued fees coverage but only burn `debt_amount`, leaving protocol revenue uncollected.

**Fix:**  
Updated `cdp_borrow_stable`, `cdp_liquidate`, and `cdp_liquidate_v2` to use `effective_debt = debt_amount + accrued_fees` in all ratio calculations and liquidation checks. Liquidation now burns `debt_amount + accrued_fees` and updates both fields.  
**Status:** ✅ Fixed in this PR.

---

## MEDIUM

### MED-01 — `init_yield_collateral` Does Not Deduplicate `initial_mints`

**Instruction:** `init_yield_collateral`  
**File/Line:** `programs/sss-token/src/instructions/yield_collateral.rs:65`

**Description:**  
`add_yield_collateral_mint` correctly rejects duplicates, but `init_yield_collateral_handler` passes `initial_mints` directly to `whitelisted_mints` without deduplication. A caller can populate the 8-slot whitelist with duplicates at init time, artificially consuming slots and potentially confusing downstream checks.

**Fix:**  
Add duplicate-check loop in `init_yield_collateral_handler` before assigning `whitelisted_mints`.

**Status:** None found in scope — marked for follow-up as improvement ticket.

---

### MED-02 — APC `force_close` Can Clear a `Disputed` Channel Without Resolution

**Instruction:** `force_close`  
**File/Line:** `programs/sss-token/src/instructions/apc.rs:370–410`

**Description:**  
`force_close` checks `!channel.status.is_terminal()`, which returns `true` for `Disputed` channels. This means the initiator can force-close a disputed channel after timeout, returning all funds to themselves, even though the dispute may be valid. The counterparty who raised the dispute (and performed work) gets nothing.

**Exploitability:**  
The initiator raises a dispute preemptively to prevent settlement, waits for timeout, then force-closes to recover the full deposit. Or: a genuine dispute is raised by the counterparty, but after timeout the initiator force-closes before any off-chain resolution is applied on-chain.

**Status:** Noted. No on-chain dispute arbitration exists (by design — external oracle/quorum is implied by `dispute_policy`). The risk should be documented in the APC spec. Marked for follow-up.

---

### MED-03 — `propose_timelocked_op` Silently Overwrites Pending Timelocked Op

**Instruction:** `propose_timelocked_op`  
**File/Line:** `programs/sss-token/src/instructions/admin_timelock.rs:82–88`

**Description:**  
The handler overwrites any existing pending timelocked op without error. This allows authority to cancel a pending op by proposing a new one, silently resetting the clock. While this is documented ("Overwrites any existing pending op"), it means the authority can delay execution indefinitely by re-proposing.

**Status:** Noted. For strict timelock guarantees, consider requiring the old op to be cancelled explicitly before proposing a new one. Marked for future consideration.

---

### MED-04 — `set_pyth_feed` and `set_oracle_params` Not Timelocked

**Instruction:** `set_pyth_feed`, `set_oracle_params`  
**File/Line:** `programs/sss-token/src/instructions/admin_timelock.rs:144–185`

**Description:**  
Oracle configuration changes (switching the Pyth feed, changing max age, disabling confidence checks) can be made instantly by the authority without any timelock. A compromised authority could switch to a manipulated oracle feed, instantly enabling extraction from the CDP system.

**Status:** Noted. Recommend either adding these to the timelock op kinds or requiring a DAO committee vote for oracle changes. Marked for follow-up.

---

## LOW

### LOW-01 — `reserve_vault` Token Account Ownership Not Programmatically Verified

**Instruction:** `deposit_collateral`  
**File/Line:** `programs/sss-token/src/instructions/deposit_collateral.rs:44–48`

**Description:**  
The reserve vault is validated by public key (`reserve_vault.key() == config.reserve_vault`) but its token account authority (owner) is not verified to be the config PDA. At initialization time (`initialize.rs`), `reserve_vault` is accepted as a parameter without on-chain verification. If the `reserve_vault` is initialized with an incorrect authority, the config PDA cannot sign transfers out of it.

**Status:** Low impact — misconfigured vault would only hurt the deployer; it cannot be exploited by external parties. Recommend adding deployment documentation and/or an on-chain authority check.

---

### LOW-02 — `checked_add().unwrap()` in Hot Paths

**Instructions:** `mint`, `cpi_mint`, `burn`, `cdp_borrow_stable`  
**File/Lines:** Multiple handlers.

**Description:**  
Several handlers use `checked_add(amount).unwrap()` and `checked_mul(...).unwrap()`. While u64/u128 overflow is extremely unlikely given supply constraints, `.unwrap()` panics instead of returning an Anchor error, producing a less informative program failure.

**Status:** Low. Recommend replacing with `.ok_or(error!(SssError::Overflow))?` uniformly.

---

### LOW-03 — Stability Fee Not Enforced Before Collateral Withdrawal

**Instruction:** `cdp_repay_stable`  
**File/Line:** `programs/sss-token/src/instructions/cdp_repay_stable.rs`

**Description:**  
`cdp_repay_stable` allows full debt repayment and proportional collateral withdrawal without requiring outstanding `accrued_fees` to be paid first. A user can exit a CDP cleanly while the protocol's fee revenue remains in `accrued_fees` but never collected (no one can force a burn after the debt is gone).

**Status:** Noted. The fix for HIGH-05 partially mitigates this by incorporating accrued_fees into effective debt. Full mitigation requires verifying `accrued_fees == 0` or collecting them automatically in `cdp_repay_stable`. Marked for follow-up.

---

## INFO

### INFO-01 — `cpi_mint` / `cpi_burn` Do Not Emit Structured Events

**Instructions:** `cpi_mint`, `cpi_burn`  
**File/Line:** `cpi_mint.rs:90–94`, `cpi_burn.rs:71–75`

**Description:**  
The CPI composability entrypoints emit a `msg!()` log but do not emit structured `emit!()` events. The direct `mint` and `burn` handlers also lack structured events (they too use `msg!`). Off-chain indexers cannot distinguish direct vs. CPI mint/burn events without log parsing.

**Recommendation:** Add `MintTokensEvent` / `BurnTokensEvent` event structs and emit them from all mint/burn paths.

---

### INFO-02 — Two Competing Authority-Transfer Mechanisms Create UX Confusion

**Instructions:** `update_roles`, `propose_timelocked_op`  
**File/Lines:** `update_roles.rs`, `admin_timelock.rs`

**Description:**  
With the CRIT-01 fix applied, `update_roles` now blocks direct authority transfers when a timelock is configured. This is the correct behavior, but the existence of two mechanisms may confuse deployers. The `update_roles` docs should be updated to clearly state that authority transfers must use the timelock path when `admin_timelock_delay > 0`.

---

### INFO-03 — `DaoCommittee` Proposals Do Not Expire

**Instruction:** `propose_action`, `vote_action`, `execute_action`  
**File/Line:** `programs/sss-token/src/instructions/dao_committee.rs`

**Description:**  
`ProposalPda` has no expiry timestamp. Proposals remain open indefinitely and can be voted on and executed at any future time. A stale proposal (e.g., to update a minter cap that is no longer relevant) could be executed long after the context that motivated it has changed.

**Recommendation:** Add an `expires_at` field to `ProposalPda` and reject votes/executions after expiry.

---

## Code Changes Summary

The following files were modified to address CRITICAL and HIGH findings:

| File | Finding(s) Fixed |
|---|---|
| `programs/sss-token/src/error.rs` | CRIT-01, HIGH-03 — new error variants |
| `programs/sss-token/src/instructions/update_roles.rs` | CRIT-01 — timelock gate |
| `programs/sss-token/src/instructions/burn.rs` | HIGH-01 — circuit breaker |
| `programs/sss-token/src/instructions/cpi_mint.rs` | HIGH-02 — circuit breaker + velocity |
| `programs/sss-token/src/instructions/cpi_burn.rs` | HIGH-02 — circuit breaker |
| `programs/sss-token/src/instructions/bad_debt_backstop.rs` | HIGH-03 — reachable backstop |
| `programs/sss-token/src/instructions/cdp_deposit_collateral.rs` | HIGH-04 — sss_mint validation |
| `programs/sss-token/src/instructions/cdp_borrow_stable.rs` | HIGH-05 — effective debt |
| `programs/sss-token/src/instructions/cdp_liquidate.rs` | HIGH-05 — effective debt |
| `programs/sss-token/src/instructions/cdp_liquidate_v2.rs` | HIGH-05 — effective debt |
