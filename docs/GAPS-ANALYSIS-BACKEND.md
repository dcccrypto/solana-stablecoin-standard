# Backend Infrastructure Gaps Analysis — Production Stablecoin Deployment

_Task: SSS-082 | Author: sss-backend | Date: 2026-03-15_

---

## Executive Summary

The current `sss-backend` (Axum + SQLite, single process) is well-suited as a
reference implementation and developer integration target. For a production
stablecoin deployment it has significant gaps across five areas: monitoring &
alerting, API maturity, database strategy, on-chain event indexing, and
compliance / regulatory reporting. This document enumerates those gaps with
concrete recommendations.

---

## 1. Monitoring & Alerting

### What a production stablecoin needs

| Signal | Why it matters |
|--------|----------------|
| **Supply anomaly detection** | Unexpected mint / burn spikes can indicate exploits or operational errors. Thresholds and velocity checks (e.g. >5% supply change in 5 min) need automated alerting. |
| **Reserve ratio monitoring** | If collateral value drops below the peg ratio, protocol solvency is at risk. Alerts must fire before breach, not after. |
| **Blacklist event propagation latency** | Time between a blacklist write and enforcement on-chain must be bounded and monitored; failures could allow blocked addresses to transact. |
| **Large transfer detection** | Transfers above configurable USD thresholds need real-time alerts for AML compliance and circuit-breaker trigger review. |
| **Program authority / freeze authority changes** | Any SPL authority rotation is high-severity; must alert immediately. |
| **RPC node health / lag** | Stale on-chain reads due to lagging RPC can cause incorrect reserve or supply data — need slot-age monitoring. |

### Current state

- **None of the above is implemented.** The `health` endpoint returns a static
  `status: "ok"` without any business-level checks.
- No structured metrics endpoint (e.g. Prometheus `/metrics`).
- No alerting hooks — the webhook system dispatches on API-level events but is
  not wired to on-chain data or threshold logic.
- No heartbeat / liveness check that validates RPC connectivity or DB write
  latency.

### Recommended additions

1. **`/api/metrics` (Prometheus format)** — counters for mint/burn events,
   blacklist size, request rates, error rates, RPC call latency.
2. **Supply velocity middleware** — compare running 5-min mint total against a
   configurable threshold; emit webhook + structured log on breach.
3. **Reserve ratio checker** (async background task) — poll proof-of-reserves
   endpoint and configured collateral prices on a schedule; write result to DB;
   alert if ratio < configurable floor.
4. **Structured alerting layer** — abstract over webhook dispatch with severity
   levels (INFO / WARN / CRITICAL) and channel routing (Slack, PagerDuty, email).
5. **Slot-age guard** — reject or flag responses when the last confirmed slot is
   >N slots behind the cluster tip.

---

## 2. Production-Grade API Gaps

### Pagination & filtering

- `GET /api/events` accepts `limit` (capped at 1000) but has no `cursor`/`offset`
  for reliable deep pagination. High-volume issuers with millions of events
  need cursor-based pagination.
- No consistent `page_token` or `before`/`after` keyset pagination across
  endpoints. The audit log, blacklist, and events endpoints are inconsistent.

### Idempotency

- Mint and burn routes have no idempotency key support. Duplicate submissions
  (network retries, client bugs) silently create duplicate DB rows. Production
  financial APIs require idempotent POST semantics with a client-supplied key.

### Request validation

- Input validation is minimal (mostly empty-string checks). Production requires:
  Pubkey format validation (base58, 32-byte), amount range checks, enum
  validation for event types, and schema versioning.

### Error responses

- `AppError` returns human-readable strings. Production needs structured error
  codes (`error.code`, `error.type`) for programmatic handling, consistent with
  standards like RFC 7807 (Problem Details).

### API versioning

- All routes are under `/api/…` with no version prefix (`/api/v1/…`). Adding
  versioning now is a breaking-change-free window; waiting until later forces
  painful migrations.

### Authentication

- API key auth (static secret in header) is the only mechanism. Production
  should support:
  - **Ed25519 request signing** (already partially present via `ed25519-dalek`
    but not enforced end-to-end).
  - **Short-lived JWT / PASETO tokens** for browser clients.
  - **Role-based scopes** (read-only keys vs. admin keys vs. minter keys).

### Missing endpoints a real issuer needs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/supply/history` | Time-series supply snapshots for reporting |
| `GET /api/events/export` | CSV / JSON bulk export for auditors |
| `POST /api/alerts/config` | Set supply / reserve alert thresholds |
| `GET /api/compliance/report` | Generate period compliance summary |
| `GET /api/holders` | Top holder distribution (requires indexer, see §4) |
| `GET /api/transactions/:sig` | Look up a specific tx and its effect |

---

## 3. Database Strategy

### SQLite limitations at production scale

| Concern | Detail |
|---------|--------|
| **Write concurrency** | SQLite serializes all writes via a single Mutex-guarded connection. Under concurrent mint/burn load (even modest — 100 req/s) this becomes a throughput bottleneck. |
| **Single file = single point of failure** | No built-in replication; corruption or disk failure loses all data. |
| **No streaming / LISTEN-NOTIFY** | Cannot push event changes to connected websocket clients without polling. |
| **Full-table scans** | The current schema has no indexes on `created_at`, `token_mint`, or `address` columns. At >100k rows queries degrade. |
| **No migrations framework** | Schema changes require manual `CREATE TABLE IF NOT EXISTS` patches; no version tracking, no rollback. |

### Recommendation: tiered DB strategy

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Operational store** | PostgreSQL 16 | API writes, compliance records, webhook state; ACID, replication, LISTEN/NOTIFY |
| **Event store / time-series** | TimescaleDB or ClickHouse | Supply snapshots, price feeds, large-scale event queries |
| **Cache** | Redis | Rate limiter state (replaces in-memory), idempotency keys, session tokens |
| **Local dev** | SQLite (keep) | Zero-config for contributors; schema must stay in sync via migrations |

Migration path: introduce `sqlx` (supports both SQLite and Postgres via the
same query macros), add `migrations/` directory with numbered `.sql` files,
run `sqlx migrate run` on startup.

### Immediate SQLite improvements (pre-migration)

Add these indexes to `init_schema`:

```sql
CREATE INDEX IF NOT EXISTS idx_mint_events_token_mint ON mint_events(token_mint);
CREATE INDEX IF NOT EXISTS idx_mint_events_created_at ON mint_events(created_at);
CREATE INDEX IF NOT EXISTS idx_burn_events_token_mint ON burn_events(token_mint);
CREATE INDEX IF NOT EXISTS idx_burn_events_created_at ON burn_events(created_at);
CREATE INDEX IF NOT EXISTS idx_blacklist_address ON blacklist(address);
CREATE INDEX IF NOT EXISTS idx_audit_log_address ON audit_log(address);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
```

---

## 4. On-Chain Event Indexing

### Current approach

The backend has **no on-chain indexer**. It records only events that pass
through its own API (i.e. mint/burn calls it initiates or receives). It cannot
reconstruct history from the chain, replay events, or serve queries like
"all transfers of token X in the last 24 hours."

### What's missing

| Gap | Impact |
|-----|--------|
| **No transaction log listener** | Cannot detect mints/burns submitted directly via CLI or other clients — audit log is incomplete. |
| **No transfer hook event capture** | The transfer hook program fires on every SPL transfer but the backend never sees these events. |
| **No program log parsing** | Anchor emits structured events in transaction logs; no listener parses them into the DB. |
| **No slot/block catching-up** | If the backend restarts, it has no way to replay missed events. |
| **No holder index** | Cannot answer "who holds how much" without a full token-account scan on every request. |

### Recommended indexing architecture

```
Solana cluster
    │
    ▼
[geyser plugin / websocket subscription]
    │  programSubscribe / logsSubscribe / accountSubscribe
    ▼
[sss-indexer service] (new)
    │  parses Anchor event logs, transfer hook CPI data
    ▼
[PostgreSQL event_log table]
    │
    ▼
[sss-backend] reads indexed data, no direct RPC for history queries
```

**Short-term (no geyser):** Add a background Tokio task that calls
`getSignaturesForAddress` on a polling interval, parses transaction logs for
known Anchor event discriminators, and writes them to the DB. This is
eventually consistent but covers the most critical gap.

**Long-term:** Deploy a [Yellowstone gRPC geyser
plugin](https://github.com/rpcpool/yellowstone-grpc) sidecar for real-time
streaming at sub-slot latency.

---

## 5. Compliance & Regulatory Reporting

### What regulators actually require (stablecoin context)

Based on MiCA (EU), FinCEN guidance, and emerging US stablecoin frameworks:

| Requirement | Details |
|-------------|---------|
| **Transaction reports** | All transactions above threshold (e.g. €10k / $10k) must be logged with sender, recipient, amount, timestamp, tx hash. |
| **Suspicious Activity Reports (SAR)** | Automated detection and manual filing workflow for unusual patterns. |
| **Proof of Reserves (PoR)** | Periodic (daily/monthly) signed attestations of collateral backing. Must be verifiable and tamper-evident. |
| **Blacklist screening** | OFAC/SDN list integration; must screen addresses at transaction time, not just at enrollment. |
| **Travel Rule (FATF)** | For transfers >$3k: originator and beneficiary identifying information must accompany the transfer (VASP-to-VASP). |
| **Audit log retention** | Immutable audit records retained for 5–7 years; must not be deleteable via API. |
| **Data residency** | Some jurisdictions require data to remain in-region (EU: GDPR, data sovereignty). |

### Current state

| Feature | Status |
|---------|--------|
| Blacklist (add/remove/query) | ✅ Implemented |
| Audit log | ✅ Basic implementation |
| Compliance rules | ✅ Stub (`compliance_rules.rs` exists) |
| PoR supply snapshot | ✅ Single-leaf Merkle (basic) |
| OFAC list integration | ❌ Missing |
| Travel Rule data capture | ❌ Missing |
| SAR workflow | ❌ Missing |
| Bulk export for auditors | ❌ Missing |
| Audit log immutability | ❌ Records deleteable via DB; no append-only enforcement |
| Threshold-based transaction reports | ❌ Missing |
| Periodic PoR scheduler | ❌ Missing |
| Data residency controls | ❌ Missing |

### Priority recommendations

1. **OFAC/SDN integration** — Add a background job that fetches the OFAC SDN
   list (or integrates Chainalysis / TRM Labs API) and cross-references against
   blacklist on mint/burn. Reject transactions to/from sanctioned addresses.

2. **Audit log hardening** — Remove any delete path from `audit_log`; enforce
   append-only at the DB level (trigger or revoked DELETE privilege). Add
   Merkle-chain linking between records so tampering is detectable.

3. **Compliance export endpoint** — `GET /api/compliance/report?from=&to=&format=csv`
   that generates a period report: all transactions, blacklist changes, authority
   rotations, threshold alerts.

4. **Threshold reporting** — Configurable large-transaction threshold; matching
   events written to a `reportable_transactions` table with status tracking
   (pending_review / filed / cleared).

5. **Travel Rule stub** — Capture and store originator VASP data on mint
   operations for transfers above threshold; expose via
   `POST /api/compliance/travel-rule`.

---

## 6. Summary Priority Matrix

| Gap | Severity | Effort | Priority |
|-----|----------|--------|----------|
| DB indexes (SQLite) | High | Low | **P0 — immediate** |
| Prometheus `/metrics` | High | Medium | **P0** |
| Cursor-based pagination | High | Low | **P0** |
| API versioning (`/v1/`) | High | Low | **P0** |
| Idempotency keys | High | Medium | **P1** |
| Supply velocity alerting | High | Medium | **P1** |
| OFAC blacklist integration | Critical | Medium | **P1** |
| Audit log immutability | Critical | Low | **P1** |
| On-chain polling indexer | High | High | **P1** |
| PostgreSQL migration | Medium | High | **P2** |
| Travel Rule capture | Medium | Medium | **P2** |
| Role-based API scopes | Medium | Medium | **P2** |
| Geyser indexer | Low | High | **P3** |
| SAR workflow | Low | High | **P3** |

---

_This document represents a point-in-time analysis of `sss-backend` at the SSS-082 task
boundary. It should be revisited after SSS-078 devnet deployment and any upstream
breaking changes to the Anchor IDL or SPL token extensions._
