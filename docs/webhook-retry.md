# Webhook Retry & Exponential Backoff

The SSS backend delivers webhook notifications with automatic retry and exponential backoff so transient subscriber failures don't result in silent data loss.

---

## Overview

When the backend fires a webhook event (e.g. `mint`, `burn`), it dispatches HTTP POST requests to all registered subscriber URLs. Each delivery is handled in an isolated `tokio::spawn` task and **does not block or affect the API response**.

If a delivery attempt fails, the backend retries up to a configurable maximum number of times before giving up. All outcomes are emitted as structured log events.

---

## Retry Schedule

| Attempt | Delay before attempt |
|---------|---------------------|
| 1       | Immediate (0 s)     |
| 2       | 1 s                 |
| 3       | 2 s                 |

The delay before attempt *n* (1-indexed, n > 1) is `2^(n-2)` seconds:

```
attempt 1 → 0s → POST
attempt 2 → 1s → POST
attempt 3 → 2s → POST
[give up, log warning]
```

**Constants** (in `backend/src/webhook_dispatch.rs`):

```rust
const MAX_RETRIES: u32 = 3;
// delay for attempt n (0-indexed, n > 0) = 2^(n-1) seconds
```

---

## Delivery Semantics

- **At-most-once per attempt**: each attempt is a single HTTP POST with a 5-second timeout.
- **Best-effort overall**: after `MAX_RETRIES` exhausted attempts, the delivery is abandoned. No persistent queue or dead-letter store is written.
- **Non-blocking**: failures never propagate to the caller; the API returns success regardless of webhook outcome.
- **Per-subscriber isolation**: each subscriber URL gets its own retry loop running in its own task.

---

## Payload Format

Every POST carries the same JSON envelope:

```json
{
  "event":        "mint",
  "data":         { ... },
  "delivered_at": "2026-03-14T17:00:00Z"
}
```

- `event` — event kind (`"mint"` | `"burn"`)
- `data` — event-specific payload (token mint address, amount, authority, etc.)
- `delivered_at` — RFC-3339 UTC timestamp of when the delivery was first triggered

---

## Logging

Each attempt emits a structured `tracing` span:

| Outcome | Level | Fields |
|---------|-------|--------|
| Success | `INFO` | `url`, `attempt` |
| Failure | `WARN` | `url`, `attempt`, `max`, `error` |
| Exhausted | `WARN` | `url`, message |

Example log output:

```
WARN url=https://example.com/hook attempt=1 max=3 error="connection refused" "Webhook delivery failed"
WARN url=https://example.com/hook attempt=2 max=3 error="connection refused" "Webhook delivery failed"
WARN url=https://example.com/hook attempt=3 max=3 error="connection refused" "Webhook delivery failed"
WARN url=https://example.com/hook "Webhook delivery exhausted 3 attempts, giving up"
```

---

## Registering a Webhook

Use the REST API to subscribe a URL to an event type:

```bash
# Register a URL for all mint events
curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-app.example.com/hooks/sss","event_type":"mint"}'
```

See [api.md](./api.md) for full webhook CRUD endpoints.

---

## Extending the Retry Policy

To adjust retry count or backoff, edit `backend/src/webhook_dispatch.rs`:

```rust
const MAX_RETRIES: u32 = 3;          // increase for more resilience

// In deliver_with_retry():
let delay_secs = u64::pow(2, attempt - 1);  // change formula for different backoff curve
```

A future enhancement (SSS-014 / persistent queue) could replace best-effort delivery with a durable outbox pattern for guaranteed at-least-once semantics.

---

## Tests

```
cargo test -p sss-backend webhook
```

Covers:

| Test | What it checks |
|------|----------------|
| `test_retry_constants` | `MAX_RETRIES == 3`; delay math is correct |
| `test_deliver_with_retry_bad_url` | retry loop completes gracefully after 3 failed attempts; no panic |
