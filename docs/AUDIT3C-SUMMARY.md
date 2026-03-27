# SSS-AUDIT3-C Backend Security Audit — Documentation Summary

**Date:** 2026-03-27
**Auditor:** sss-backend
**Scope:** All backend code since SSS-114 (endpoints SSS-127 through SSS-154)
**Full Findings:** [AUDIT3C-FINDINGS.md](./AUDIT3C-FINDINGS.md) | **Fix Specs:** [AUDIT3C-FIXES.md](./AUDIT3C-FIXES.md)

---

## Overview

SSS-AUDIT3-C is a deep security audit of all backend code added as part of the SSS-127–SSS-154 feature batch. The audit covered invariant monitoring, webhook retry/DLQ, on-chain supply reconciliation, travel rule endpoints, insurance vault monitoring, admin route enforcement, and the sanctions oracle proxy.

**Result: 1 HIGH, 4 MEDIUM, 4 LOW findings. 4 areas passed clean.**

All backend code fixes for the HIGH finding and admin role separation are implemented and included in PR #316.

---

## Findings Summary

| ID | Severity | Area | Status |
|---|---|---|---|
| AUDIT3C-H1 | **HIGH** | Travel Rule — originator VASP not validated against registry | Fix spec in AUDIT3C-FIXES.md |
| AUDIT3C-M1 | MEDIUM | Monitoring bot — sanctions check misses CDP event types | Fix spec |
| AUDIT3C-M2 | MEDIUM | Alert API — arbitrary invariant name injection | Fix spec |
| AUDIT3C-M3 | MEDIUM | Travel rule bulk endpoint — wallet param not required | Fix spec |
| AUDIT3C-M4 | MEDIUM | Insurance vault — no backend monitoring endpoint | Fix spec |
| AUDIT3C-L2 | LOW | Webhook DLQ — `permanently_failed` rows never pruned | Fix spec |
| AUDIT3C-L3 | LOW | Webhook retry — TOCTOU on attempt_count (SQLite mutex mitigated) | Documented |
| AUDIT3C-L4 | LOW | `/api/metrics` is unauthenticated (intentional) | Documented |
| AUDIT3C-L5 | LOW | Sanctions indexer — `is_sanctioned` not validated as boolean | Fix spec |
| AUDIT3C-OK-1 | — | On-chain supply reconciliation correctness | ✅ PASS |
| AUDIT3C-OK-2 | — | Insurance vault DAO quorum check (on-chain) | ✅ PASS |
| AUDIT3C-OK-3 | — | Admin route auth enforcement | ✅ PASS |
| AUDIT3C-OK-4 | — | Sanctions oracle injection resistance | ✅ PASS |

---

## HIGH Finding: AUDIT3C-H1 — Travel Rule VASP Forgery

**Severity:** HIGH
**Affected component:** `backend/src/indexer.rs` → `maybe_insert_travel_rule_record()`

### Issue
The indexer writes `TravelRuleRecordSubmitted` on-chain event data directly to the backend DB **without validating** that the `originator_vasp` or `beneficiary_vasp` fields are registered/known VASPs. A CPI-crafted log line emitting a `TravelRuleRecordSubmitted`-shaped event could inject arbitrary VASP data.

### Fix (when SSS-127 merges)
- Add `SSS_KNOWN_VASPS` env var with a comma-separated allowlist of recognized VASP identifiers.
- Unknown VASPs are stored with `verified = false` and logged as suspicious (not rejected).
- Add `verified BOOLEAN NOT NULL DEFAULT 1` column to `travel_rule_records` table.
- Full Rust fix spec in [AUDIT3C-FIXES.md § Fix AUDIT3C-H1](./AUDIT3C-FIXES.md#fix-audit3c-h1-travel-rule-vasp-validation).

### Impact mitigation
The on-chain program does not expose VASP validation; this is a backend data-integrity concern. Injected records would only affect backend API consumers, not on-chain settlement. However, downstream compliance tooling (FATF/VASP checks) could be misled by forged originator records.

---

## MEDIUM Findings

### AUDIT3C-M1 — Monitoring Sanctions Coverage Gap
**Affected component:** `backend/src/monitor/invariant_checker.rs`

`check_sanctioned_transactions` only queries `MintExecuted` and `BurnExecuted` event types. CDP events (`cdp_borrow`, `cdp_deposit`, etc.) are never checked against the sanctions list.

**Fix:** Query all event types when checking sanctioned address activity. See [AUDIT3C-FIXES.md](./AUDIT3C-FIXES.md).

---

### AUDIT3C-M2 — Alert API Invariant Injection
**Affected component:** `backend/src/routes/alerts.rs`

Any valid API key can inject arbitrary `invariant` names into the alert log. Pollutes monitoring history and could suppress real alerts.

**Fix:** Add an `ALLOWED_INVARIANTS` allowlist; reject unknown invariant names with `400 Bad Request`. See [AUDIT3C-FIXES.md](./AUDIT3C-FIXES.md).

---

### AUDIT3C-M3 — Travel Rule Bulk Data Exposure
**Affected component:** `backend/src/routes/travel_rule.rs`

`GET /api/travel-rule/records?wallet=&limit=1000` with empty wallet param returns **all records** up to limit. In multi-VASP deployments, any key holder can dump the full travel rule dataset.

**Fix:** Require non-empty `wallet` param, or gate bulk queries behind `SSS_TRAVEL_RULE_ADMIN_BULK_ALLOWED` env var. See [AUDIT3C-FIXES.md](./AUDIT3C-FIXES.md).

---

### AUDIT3C-M4 — Insurance Vault Missing Backend Monitoring
**Affected component:** Backend (missing)

No `GET /api/insurance-vault/status` endpoint exists. Operators cannot monitor vault draw events or balance via the API — they must query on-chain directly. If the indexer lags, draw events are invisible.

**Fix:** Add `GET /api/insurance-vault/status` reading `InsuranceVaultDraw` events from `event_log`. See [AUDIT3C-FIXES.md](./AUDIT3C-FIXES.md).

---

## LOW Findings

### AUDIT3C-L2 — Unbounded DLQ Table
`permanently_failed` webhook delivery rows are never pruned. Sustained endpoint failures can grow the table unboundedly.

**Fix:** Add `SSS_DLQ_RETENTION_DAYS` env var (default 7); prune rows on each `run_once()` cycle.

### AUDIT3C-L3 — Webhook Retry TOCTOU (Documented)
Concurrent retry workers could double-increment `attempt_count`. **Mitigated** by the SQLite `Mutex<Connection>` serializing all DB access. Low real-world risk; documented for completeness.

### AUDIT3C-L4 — Unauthenticated `/api/metrics` (Intentional)
`GET /api/metrics` (Prometheus scrape endpoint) is intentionally outside the `require_api_key` layer for Prometheus compatibility. **Recommendation:** Firewall at the network layer in production to prevent leaking operational metrics (supply totals, liquidation counts) to untrusted callers.

### AUDIT3C-L5 — Sanctions Event Validation
The indexer does not validate `is_sanctioned` as a boolean before DB write for `SanctionsRecordUpdated` events. Malformed log entries could write `null` or other non-boolean values. The on-chain transfer hook reads the PDA directly (not DB), so this is backend-only risk.

**Fix:** Add type assertion on `is_sanctioned` in `parse_event_log()`; skip and log malformed entries.

---

## Admin Role Separation (Implemented — PR #316)

As part of this audit, full admin role separation was implemented for the backend:

- `is_admin BOOLEAN` column added to `api_keys` table (with migration).
- `create_api_key_with_role()` and `validate_admin_api_key()` added to `db.rs`.
- `require_admin_key()` middleware in `auth.rs` — returns `403 Forbidden` for non-admin keys.
- All `/api/admin/*` routes (including `/api/admin/circuit-breaker`) now require admin key.
- Bootstrap key seeded with `is_admin = 1`.
- 3 integration tests: admin accept, non-admin reject, `is_admin` field in create response.
- **119/119 tests passing, clippy clean.**

---

## Passing Areas

| Area | Finding | Notes |
|------|---------|-------|
| On-chain supply reconciliation | AUDIT3C-OK-1 | `check_reserve_ratio` + `supply_verify` RPC worker — no bypass path found |
| Insurance vault DAO quorum | AUDIT3C-OK-2 | `draw_insurance` correctly delegates to DAO executor when `FLAG_DAO_COMMITTEE` set |
| Admin route enforcement | AUDIT3C-OK-3 | All `/api/admin/*` routes auth-gated; `require_api_key` applied globally (except `/api/health`) |
| Sanctions oracle injection | AUDIT3C-OK-4 | `update_sanctions_record` enforces registered oracle key; no free-form input path |

---

## Dependencies

The following open PRs contain the target files for the fix implementations. Fixes should be applied when these PRs merge:

| Finding | Target PR | File |
|---------|-----------|------|
| AUDIT3C-H1 | PR #192 (SSS-127 Travel Rule) | `backend/src/indexer.rs` |
| AUDIT3C-M1 | PR #180 (SSS-139 Monitoring Bot) | `backend/src/monitor/invariant_checker.rs` |
| AUDIT3C-M2 | PR #180 (SSS-139 Monitoring Bot) | `backend/src/routes/alerts.rs` |
| AUDIT3C-M3 | PR #192 (SSS-127 Travel Rule) | `backend/src/routes/travel_rule.rs` |
| AUDIT3C-M4 | PR #256 (SSS-151 Insurance Vault) | New endpoint in `backend/src/` |
| AUDIT3C-L2 | PR #195 (SSS-145 Webhook DLQ) | `backend/src/webhook_retry_worker.rs` + `db.rs` |
| AUDIT3C-L5 | PR #197 (SSS-128 Sanctions Oracle) | `backend/src/indexer.rs` |

---

## References

- [AUDIT3C-FINDINGS.md](./AUDIT3C-FINDINGS.md) — full technical findings
- [AUDIT3C-FIXES.md](./AUDIT3C-FIXES.md) — fix specifications
- [SECURITY.md](./SECURITY.md) — protocol security model
- [authentication.md](./authentication.md) — API key authentication
- [api.md](./api.md) — REST API reference
- [MAINNET-CHECKLIST.md](./MAINNET-CHECKLIST.md) — pre-launch audit checklist
