# SSS-AUDIT3-C Fixes

Companion to AUDIT3C-FINDINGS.md. Each fix is a targeted patch for the identified issue.

## Fix AUDIT3C-H1: Travel Rule VASP Validation

**Target file (when SSS-127 merges):** `backend/src/indexer.rs` — `maybe_insert_travel_rule_record()`

Add an environment-variable-driven VASP allowlist check:

```rust
/// Validate originator_vasp/beneficiary_vasp against SSS_KNOWN_VASPS if set.
/// Returns true if the VASP is allowed, false if allowlist exists and VASP is not in it.
fn is_known_vasp(vasp: &str) -> bool {
    match std::env::var("SSS_KNOWN_VASPS").ok() {
        None => true, // no allowlist configured — accept all
        Some(list) => list.split(',').any(|v| v.trim() == vasp),
    }
}

// In maybe_insert_travel_rule_record(), add after parsing originator_vasp/beneficiary_vasp:
if !is_known_vasp(&originator_vasp) {
    warn!("SSS-127: unknown originator_vasp '{}' — storing with verified=false", originator_vasp);
    // Still insert but with verified=false flag
}
if !is_known_vasp(&beneficiary_vasp) {
    warn!("SSS-127: unknown beneficiary_vasp '{}' — storing with verified=false", beneficiary_vasp);
}
```

Also add `verified BOOLEAN NOT NULL DEFAULT 1` column to `travel_rule_records` table.

## Fix AUDIT3C-M1: Monitoring Sanctions Coverage

**Target file (when SSS-139 merges):** `backend/src/monitor/invariant_checker.rs`

Replace the two narrow event queries with an all-event query:

```rust
// Instead of querying only MintExecuted/BurnExecuted, query ALL recent events:
let Ok(all_events) = state.db.query_event_log(None, None, 2000, 0) else {
    return InvariantStatus::Ok;
};
// Then check sanctioned set against all addresses in all events
```

## Fix AUDIT3C-M2: Alert Injection Prevention

**Target file (when SSS-139 merges):** `backend/src/routes/alerts.rs`

Add invariant name allowlist to `post_alert`:

```rust
const ALLOWED_INVARIANTS: &[&str] = &[
    "supply_consistency", "reserve_ratio", "sanctioned_transaction",
    "circuit_breaker", "webhook_retry", "external",
];

// In post_alert(), after validation:
let invariant_clean = req.invariant.to_lowercase();
let valid_name = ALLOWED_INVARIANTS.iter().any(|&a| invariant_clean.starts_with(a));
if !valid_name {
    return Err((StatusCode::BAD_REQUEST, Json(ApiResponse::err("unknown invariant name"))));
}
```

## Fix AUDIT3C-M3: Travel Rule Data Exposure

**Target file (when SSS-127 merges):** `backend/src/routes/travel_rule.rs`

Require non-empty wallet or explicit admin scope:

```rust
pub async fn get_travel_rule_records(
    State(state): State<AppState>,
    Query(params): Query<TravelRuleQuery>,
) -> Result<Json<ApiResponse<Vec<TravelRuleRecord>>>, StatusCode> {
    // Require wallet filter unless SSS_TRAVEL_RULE_ADMIN_BULK_ALLOWED is set
    if params.wallet.as_deref().unwrap_or("").is_empty() {
        let admin_bulk = std::env::var("SSS_TRAVEL_RULE_ADMIN_BULK_ALLOWED")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);
        if !admin_bulk {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    // ... rest of handler
}
```

## Fix AUDIT3C-L2: Unbounded DLQ

**Target file (when SSS-145 merges):** `backend/src/webhook_retry_worker.rs`

Add periodic DLQ cleanup in `run_once()`:

```rust
// At end of run_once(), prune old permanently_failed rows:
let retention_days: i64 = std::env::var("SSS_DLQ_RETENTION_DAYS")
    .ok().and_then(|v| v.parse().ok()).unwrap_or(7);
let cutoff = (Utc::now() - Duration::days(retention_days)).to_rfc3339();
if let Err(e) = state.db.prune_dlq_before(&cutoff) {
    warn!("retry_worker: DLQ prune error: {e}");
}
```

And in `db.rs`:
```rust
pub fn prune_dlq_before(&self, cutoff: &str) -> Result<usize, AppError> {
    let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let n = conn.execute(
        "DELETE FROM webhook_delivery_log WHERE status = 'permanently_failed' AND created_at < ?1",
        params![cutoff],
    )?;
    Ok(n)
}
```

## Fix AUDIT3C-L5: Sanctions Event Validation

**Target file (when SSS-128 merges):** `backend/src/indexer.rs` — `parse_event_log()`

In the `collateral_registered`/`collateral_config_updated` side-effect block, add a similar guard for `SanctionsRecordUpdated`:

```rust
if event_type == "sanctions_record_updated" {
    // Validate is_sanctioned is boolean; drop if malformed
    if let Some(is_sanctioned) = data.get("is_sanctioned") {
        if !is_sanctioned.is_boolean() {
            warn!("indexer: SanctionsRecordUpdated has non-boolean is_sanctioned — skipping DB write");
            continue;
        }
    }
}
```
