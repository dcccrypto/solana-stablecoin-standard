# SSS-147D: Timelock Coverage Verification — Oracle + Compliance Authority Ops

**Status:** ✅ All ops verified covered (no new code required)
**Date:** 2026-03-27
**Related:** BUG-010, SSS-085 Fix 2

---

## Summary

SSS-147D audited whether oracle and compliance authority operations are protected
by the admin timelock mechanism introduced in SSS-085 / BUG-010.

**Result:** All three target operations were already fully covered by BUG-010.
No new code was required.

---

## Verified Constants (`programs/sss-token/src/state.rs`)

| Constant                              | Value | Present? |
|---------------------------------------|-------|----------|
| `ADMIN_OP_SET_PYTH_FEED`              | 4     | ✅ line 117 |
| `ADMIN_OP_SET_ORACLE_PARAMS`          | 5     | ✅ line 119 |
| `ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` | 10  | ✅ line 130 |

---

## Verified Timelock Lifecycle (`programs/sss-token/src/instructions/admin_timelock.rs`)

### `propose_timelocked_op_handler` match arm

All three ops appear in the `matches!()` guard:

```rust
ADMIN_OP_SET_PYTH_FEED                  // op_kind 4 ✅
ADMIN_OP_SET_ORACLE_PARAMS              // op_kind 5 ✅
ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY  // op_kind 10 ✅
```

### `execute_timelocked_op_handler` match arm

All three ops have dedicated execution branches:

- **`ADMIN_OP_SET_PYTH_FEED`**: sets `config.expected_pyth_feed` and
  `config.oracle_feed` (when `oracle_type == 0`). ✅
- **`ADMIN_OP_SET_ORACLE_PARAMS`**: unpacks `param` into `max_age_secs` and
  `max_conf_bps`, writes both fields. ✅
- **`ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY`**: stages transfer into
  `config.pending_compliance_authority`. Additionally hardened by BUG-019:
  always enforces `DEFAULT_ADMIN_TIMELOCK_DELAY` (432 000 slots ≈ 48 h)
  regardless of the configured delay, preventing a compromised authority from
  shortcutting the guard. ✅

---

## Direct-Call Handlers (Gated by `require_timelock_executed`)

Legacy entry points exist for backwards-compatibility but are blocked whenever
`admin_timelock_delay > 0`:

| Handler                    | Calls `require_timelock_executed`? | Op Kind arg            |
|----------------------------|------------------------------------|------------------------|
| `set_pyth_feed_handler`    | ✅ yes                              | `ADMIN_OP_SET_PYTH_FEED` |
| `set_oracle_params_handler`| ✅ yes                              | `ADMIN_OP_SET_ORACLE_PARAMS` |

`require_timelock_executed` returns `Err(SssError::TimelockRequired)` when
`admin_timelock_delay > 0`, making these paths unreachable in production
deployments without completing the full propose → wait → execute lifecycle.

> **Note:** There is no `transfer_compliance_authority` direct-call handler;
> that operation was only ever exposed via the timelock path.

---

## Conclusion

BUG-010 comprehensively covered all 17 privileged admin operations, including
the three operations targeted by SSS-147D.  No changes to program logic were
needed.  This document serves as the audit trail for the SSS-147D review.
