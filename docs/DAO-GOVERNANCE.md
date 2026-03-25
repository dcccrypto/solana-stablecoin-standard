# SSS — DAO Committee Governance

> **Feature:** DAO Committee (`dao_committee.rs`)  
> **Security fix:** BUG-011 / AUDIT-A CRIT-05 (2026-03-25) — proposal creation opened to committee members; `FLAG_DAO_COMMITTEE` protected from authority override

---

## Overview

SSS supports an optional DAO committee governance layer. When `FLAG_DAO_COMMITTEE` is enabled in `feature_flags`, protocol governance decisions are made through a committee-based proposal system rather than by the authority key alone.

DAO governance is **opt-in** at the protocol level. It is enabled by setting `FLAG_DAO_COMMITTEE` via the normal feature-flag flow (timelocked). Once enabled, the flag itself is protected from being cleared by the authority — doing so requires a DAO proposal to prevent authority capture.

---

## Proposal Lifecycle

```
Committee member (or authority)
        │
        ▼
  propose_action()          ← Creates on-chain proposal
        │
        ▼
  [Voting period]           ← Committee members vote
        │
        ▼
  execute_timelocked_op()   ← Execute approved proposal after timelock
```

---

## Who Can Create Proposals

**Before BUG-011:** Only the authority key could call `propose_action`, making the DAO effectively authority-captured — committee members had no independent ability to initiate governance.

**After BUG-011 (AUDIT-A CRIT-05):** Any current committee member **or** the authority can create a proposal. Callers that are neither a committee member nor the authority receive `NotAuthorizedToPropose`.

---

## `FLAG_DAO_COMMITTEE` Protection

When `FLAG_DAO_COMMITTEE` is active:

- **`feature_flags.rs` direct set/clear:** Blocked — the flag cannot be toggled directly while DAO is active (unchanged, pre-existing protection).
- **`execute_timelocked_op(ADMIN_OP_CLEAR_FEATURE_FLAG)`:** Now also blocked when the flag target is `FLAG_DAO_COMMITTEE`. Returns `DaoFlagProtected`. This closes the previously-open path where the authority could clear the DAO flag via the timelock execute path, bypassing the direct-call guard.

To disable the DAO committee once active, a DAO proposal must be used.

---

## Error Reference

| Error | Cause |
|---|---|
| `NotAuthorizedToPropose` | Caller is neither a committee member nor the authority |
| `DaoFlagProtected` | Attempted to clear `FLAG_DAO_COMMITTEE` via `execute_timelocked_op`; use a DAO proposal instead |

---

## Security Notes

- **Do not confuse DAO proposals with the admin timelock.** Admin timelock ops (propose → 2-day wait → execute) and DAO proposals are separate mechanisms. DAO proposals have their own voting and execution path.
- **`FLAG_DAO_COMMITTEE` once set is sticky.** The authority cannot unilaterally remove DAO governance. Plan the governance structure carefully before enabling the flag on mainnet.
- **Committee membership management** is still an authority-controlled operation. Ensure committee members are added before enabling the flag, and review the authority's remaining powers carefully.

---

## Audit Finding

### BUG-011 (AUDIT-A CRIT-05) — Authority-Captured DAO Governance

**Fixed in:** on-chain program (2026-03-25)

**Description:** Two issues combined to make the SSS DAO committee effectively non-functional:

1. **Proposal creation gated on authority:** `propose_action` required the transaction signer to be the `authority` key. Committee members could vote but not initiate proposals — governance initiative was fully in the authority's hands.

2. **FLAG_DAO_COMMITTEE clearable via timelock:** `execute_timelocked_op` with `ADMIN_OP_CLEAR_FEATURE_FLAG` targeting `FLAG_DAO_COMMITTEE` would succeed, allowing the authority to silently remove DAO governance after a 2-day window, even though the direct-call path was already blocked by `feature_flags.rs`.

**Fix:**
- `propose_action`: caller must be a committee member OR the authority; otherwise returns `NotAuthorizedToPropose`.
- `execute_timelocked_op(ADMIN_OP_CLEAR_FEATURE_FLAG)`: if the target flag is `FLAG_DAO_COMMITTEE`, returns `DaoFlagProtected` unconditionally.

**Tests added:** member-can-propose, non-member/non-authority-rejected, authority-cannot-clear-DAO-flag-via-timelock.
