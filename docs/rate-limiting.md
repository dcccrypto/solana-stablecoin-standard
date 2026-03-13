# SSS Backend — Rate Limiting

> **Feature:** SSS-009  
> **Scope:** In-memory, per-API-key token-bucket rate limiter

---

## Overview

Every authenticated request is subject to a token-bucket rate limit keyed by the caller's API key. The `require_api_key` middleware validates the `X-Api-Key` header first; once the key is confirmed valid, the rate-limiter checks the token bucket. Requests that exceed the limit are rejected with **HTTP 429** before they reach any route handler, protecting the backend from runaway clients and accidental request storms.

The limiter is entirely **in-memory** and resets when the process restarts. This is appropriate for single-instance deployments; distributed setups would require a shared store (e.g. Redis).

---

## Algorithm: Token Bucket

Each API key maintains an independent bucket with two parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `capacity` | `60` | Maximum tokens the bucket can hold (burst limit) |
| `refill_per_second` | `1.0` | Tokens added per second (steady-state rate) |

**How it works:**

1. A new key starts with a **full bucket** (`capacity` tokens).
2. Each request **consumes 1 token**.
3. Tokens **refill continuously** at `refill_per_second` up to `capacity`.
4. If the bucket is **empty**, the request is rejected with `429 Too Many Requests`.

**Default behaviour:**
- Burst of up to **60 requests** before any rate limiting kicks in.
- After the burst, the steady-state limit is **1 request/second** (60 req/min sustained).
- Different API keys have **independent** buckets — one key's traffic does not affect another.

---

## HTTP Response on Rate Limit

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 1

{
  "success": false,
  "error": "Rate limit exceeded"
}
```

The `Retry-After` header is included in every 429 response when the limiter has a non-zero refill rate. Its value is the number of **whole seconds** the client must wait before the token bucket will have at least one token available again (calculated as `ceil((1 - current_tokens) / refill_per_second)`).

If the limiter is configured with `RATE_LIMIT_RPS=0` (zero refill), no `Retry-After` header is emitted because the bucket will never recover without a process restart.

Clients should honour the `Retry-After` value; falling back to exponential back-off is recommended when the header is absent.

---

## Affected Endpoints

Rate limiting applies to **all authenticated endpoints**. The public health endpoint (`GET /api/health`) is exempt.

| Endpoint | Auth Required | Rate Limited |
|----------|:---:|:---:|
| `GET /api/health` | — | ✗ |
| `POST /api/mint` | ✓ | ✓ |
| `POST /api/burn` | ✓ | ✓ |
| `GET /api/supply` | ✓ | ✓ |
| `GET /api/events` | ✓ | ✓ |
| `GET /api/compliance/blacklist` | ✓ | ✓ |
| `POST /api/compliance/blacklist` | ✓ | ✓ |
| `GET /api/compliance/audit` | ✓ | ✓ |
| `GET /api/webhooks` | ✓ | ✓ |
| `POST /api/webhooks` | ✓ | ✓ |
| `DELETE /api/webhooks/:id` | ✓ | ✓ |
| `GET /api/admin/keys` | ✓ | ✓ |
| `POST /api/admin/keys` | ✓ | ✓ |
| `DELETE /api/admin/keys/:id` | ✓ | ✓ |

---

## Configuration

Since **SSS-010**, rate-limit parameters are read from environment variables at startup (no recompile needed):

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_CAPACITY` | `60` | Burst size — maximum tokens a bucket can hold |
| `RATE_LIMIT_RPS` | `1.0` | Refill rate — tokens added per second per key |

Invalid or missing values fall back to the defaults and emit a warning log line.

**Examples:**

```bash
# Allow 120-request bursts and 2 req/sec sustained
RATE_LIMIT_CAPACITY=120 RATE_LIMIT_RPS=2.0 ./sss-backend

# Docker / compose
environment:
  - RATE_LIMIT_CAPACITY=30
  - RATE_LIMIT_RPS=0.5
```

At startup the backend logs the active configuration:

```
INFO sss_backend: Rate limiter configured: capacity=60 tokens, refill=1 tokens/sec
```

The compile-time defaults (`RateLimiter::default()`) remain unchanged and are used in test fixtures that do not set these variables.

---

## Implementation Notes

- **Wiring:** The `RateLimiter` is wrapped in `Arc` and stored on `AppState` (`backend/src/state.rs`). All Axum route handlers receive `State<AppState>`, which bundles both the database handle and the limiter. The `require_api_key` middleware in `backend/src/auth.rs` is the single enforcement point.
- **Lock granularity:** A single `Mutex<HashMap<String, BucketState>>` guards all buckets. For very high concurrency, a sharded structure (e.g. `DashMap`) would reduce contention.
- **Time source:** Uses `std::time::Instant`, which is monotonic and immune to clock adjustments.
- **Memory:** Buckets are never evicted. In long-running deployments with many ephemeral API keys, memory use will grow unboundedly. Consider a periodic sweep of stale keys in a future iteration.
- **Process restarts:** All bucket state is lost on restart; keys begin with a full bucket again.

---

## Testing

Unit tests live in `backend/src/rate_limit.rs` and cover:

| Test | What it verifies |
|------|-----------------|
| `test_allows_up_to_capacity` | Exactly `capacity` requests succeed, the next is rejected |
| `test_different_keys_are_independent` | Key A's consumption does not affect Key B |
| `test_refill_over_time` | Sleeping allows tokens to refill and subsequent requests succeed |

Run with:

```bash
cd backend
cargo test
```
