# SSS-AUDIT3-C: Backend Deep Audit Findings

**Date:** 2026-03-27
**Auditor:** sss-backend
**Scope:** All backend code added since SSS-114 (SSS-127 through SSS-154)

---

## Area 1: Invariant Monitoring Bot (SSS-139)

### AUDIT3C-M1 — Monitoring bot CAN be silenced via DB manipulation (MEDIUM)
**File:** `backend/src/monitor/invariant_checker.rs`

The `check_sanctioned_transactions` invariant only queries `event_type = 'MintExecuted'` or `'BurnExecuted'`. The indexer writes `cdp_borrow`/`cdp_deposit` etc. — these event types are never checked against the sanctions list. A sanctioned address could interact via CDP routes without triggering the sanctions invariant.

**Fix needed:** Query all event types (or at minimum the indexer's tracked event types) when checking sanctioned transactions.

### AUDIT3C-M2 — POST /api/alerts is authenticated but fire_alert writes to DB directly (INFO)
**File:** `backend/src/routes/alerts.rs`

`POST /api/alerts` is behind `require_api_key` middleware (correct), but any valid API key holder can inject arbitrary `AlertRecord` events into the DB — effectively polluting the monitoring history. No severity or invariant name validation/allowlist exists.

**Fix needed:** Add allowlist for `invariant` field values; reject unknown invariant names.

### AUDIT3C-L1 — No on-chain supply divergence check vs DB (LOW)
**File:** `backend/src/monitor/invariant_checker.rs`

The `check_reserve_ratio` invariant computes ratio from DB events only. The `supply_verify` reconciliation worker (SSS-BUG-026) does call on-chain RPC but the monitor never reads those results. If the indexer lags or misses events, the monitoring bot won't detect on-chain vs DB supply divergence.

**Fix needed:** Link supply_verify results into monitoring invariants (or have monitor call check_supply_consistency using on-chain data periodically).

---

## Area 2: Webhook DLQ / Retry (SSS-145)

### AUDIT3C-L2 — DLQ is unbounded for `permanently_failed` rows (LOW)
**File:** `backend/src/db.rs` (webhook_delivery_log table)

The `permanently_failed` rows are never pruned. Under sustained webhook endpoint failures, the table grows without bound. No TTL, `MAX_DLQ_SIZE` guard, or automatic eviction exists.

**Fix needed:** Add a periodic cleanup that deletes `permanently_failed` rows older than N days (configurable via `SSS_DLQ_RETENTION_DAYS`, default 7).

### AUDIT3C-L3 — Retry loop possible if clock skew between worker polls (LOW)
**File:** `backend/src/webhook_retry_worker.rs`

`run_once()` selects `status = 'failed' AND next_retry_at <= now` — correct. But the retry worker calls `execute_attempt(attempt + 1, ...)` using `delivery.attempt_count + 1`. If two retry workers ran concurrently (e.g., hot restart with two processes), `attempt_count` could be incremented twice for the same row (TOCTOU on SQLite).

**Fix needed:** Use `UPDATE ... WHERE attempt_count = expected AND status = 'failed'` with row affinity check before spawning delivery — or rely on SQLite mutex (already in place via `Mutex<Connection>`). Since the Mutex serializes DB access, this is LOW risk but worth documenting.

---

## Area 3: On-chain Supply Reconciliation (SSS-BUG-026)

### AUDIT3C-OK-1 — Reconciliation correctness: PASS
**File:** `backend/src/routes/supply_verify.rs`

`supply_verify` correctly calls `getTokenSupply` on-chain and computes `|db_supply - onchain_supply| > threshold`. The `start_reconciliation_worker` spawns this check at configurable intervals. No false reserve ratio bypass path found.

---

## Area 4: Travel Rule Endpoints (SSS-127)

### AUDIT3C-H1 — Originator VASP not validated against on-chain registry (HIGH)
**File:** `backend/src/routes/travel_rule.rs`, `indexer.rs`

`GET /api/travel-rule/records` returns records indexed from `TravelRuleRecordSubmitted` on-chain events. The indexer calls `maybe_insert_travel_rule_record()` which writes originator/beneficiary VASP data directly from the event log payload WITHOUT validating that the originator_vasp or beneficiary_vasp are registered/known VASPs.

An attacker who can emit a crafted log line (e.g., via a CPI that emits a `TravelRuleRecordSubmitted`-shaped log) could inject arbitrary VASP data into the backend DB.

**Fix needed:** Backend should validate `originator_vasp` against a known-VASP allowlist (`SSS_KNOWN_VASPS` env var or DB table) before inserting travel_rule_records. Unknown VASPs should be logged as suspicious but still stored with `verified = false` flag.

### AUDIT3C-M3 — travel_rule/records endpoint allows wildcard wallet filter (MEDIUM)
**File:** `backend/src/routes/travel_rule.rs`

`GET /api/travel-rule/records?wallet=&limit=1000` with an empty `wallet` param returns ALL records up to limit. With a valid API key, any API consumer can dump the full travel rule record set. This is a data leak for multi-VASP deployments.

**Fix needed:** Require non-empty `wallet` param or add a separate admin-scoped endpoint for bulk queries. Alternatively, enforce that non-admin callers must supply a wallet.

---

## Area 5: Insurance Vault Draw (SSS-151)

### AUDIT3C-OK-2 — DAO quorum check: PASS (on-chain)
**File:** `programs/sss-token/src/instructions/insurance_vault.rs`

`draw_insurance` handler correctly checks `config.authority == authority.key()` AND, when `FLAG_DAO_COMMITTEE` is set, delegates trust to the DAO executor (which is responsible for quorum validation before CPI). The on-chain logic is sound.

### AUDIT3C-M4 — Backend has no draw_insurance audit endpoint (MEDIUM)
**File:** `backend/src/` (missing)

There is no backend route to query insurance vault draw events or current vault balance. Operators can't monitor draw activity via the API — they must query on-chain directly. If the indexer lags, draw events are invisible to monitoring.

**Fix needed:** Add `GET /api/insurance-vault/status` that reads `InsuranceVaultDraw` events from `event_log` and returns balance estimate + recent draws.

---

## Area 6: Admin Route Enforcement (Bug-033 fix)

### AUDIT3C-OK-3 — Admin route auth enforcement: PASS
**File:** `backend/src/auth.rs`, `backend/src/main.rs`

All admin routes (`/api/admin/*`, `/api/admin/circuit-breaker`) are in the auth-gated router. The `require_api_key` middleware is applied globally (except `/api/health`). The SSS-BUG-027 fix correctly splits CORS into `public_cors` / `admin_cors` routers.

### AUDIT3C-L4 — /api/metrics is unauthenticated (INTENTIONAL but worth noting)
**File:** `backend/src/main.rs`

`GET /api/metrics` (Prometheus scrape) is explicitly placed outside the `require_api_key` layer. This is intentional for Prometheus compatibility but leaks operational metrics (supply totals, liquidation counts) to unauthenticated callers.

**Recommendation:** Document this explicitly in MONITORING.md and note it should be firewalled at the network layer in production.

---

## Area 7: Sanctions Oracle Proxy (SSS-128)

### AUDIT3C-OK-4 — Oracle injection risk: PASS
**File:** `programs/sss-token/src/instructions/sanctions_oracle.rs`

`update_sanctions_record` enforces `config.sanctions_oracle == oracle.key()` — only the registered oracle key can update records. There is no free-form input path. The `is_sanctioned: bool` parameter is binary (no injection surface). Transfer hook reads the PDA with staleness check. Sound.

### AUDIT3C-L5 — Backend doesn't validate oracle response before DB write (LOW)
**File:** `backend/src/indexer.rs`

When the indexer processes `SanctionsRecordUpdated` events, it calls `insert_event_log` with raw data from the RPC log. The `is_sanctioned` field is taken directly from the log JSON without type validation (could be `null` or non-boolean in a malformed log). The transfer hook reads on-chain PDA directly (not DB), so this is backend-only risk.

**Fix needed:** In indexer event parsing, enforce `is_sanctioned` is a boolean for `SanctionsRecordUpdated` events; reject/log-and-skip malformed entries.

---

## Summary

| ID | Severity | Area | Status |
|---|---|---|---|
| AUDIT3C-H1 | HIGH | Travel Rule VASP forgery | NEEDS FIX |
| AUDIT3C-M1 | MEDIUM | Monitoring sanctions gap | NEEDS FIX |
| AUDIT3C-M2 | MEDIUM | Alert injection via API | NEEDS FIX |
| AUDIT3C-M3 | MEDIUM | Travel rule data leak | NEEDS FIX |
| AUDIT3C-M4 | MEDIUM | Insurance vault monitoring gap | NEEDS FIX |
| AUDIT3C-L2 | LOW | Unbounded DLQ table | NEEDS FIX |
| AUDIT3C-L3 | LOW | Retry TOCTOU (SQLite mitigated) | DOCUMENT |
| AUDIT3C-L4 | LOW | Unauth metrics endpoint | DOCUMENT |
| AUDIT3C-L5 | LOW | Sanctions event validation | NEEDS FIX |
| AUDIT3C-OK-1 | — | Reconciliation correctness | PASS |
| AUDIT3C-OK-2 | — | DAO quorum on-chain | PASS |
| AUDIT3C-OK-3 | — | Admin route enforcement | PASS |
| AUDIT3C-OK-4 | — | Sanctions oracle injection | PASS |
