# Integration Testing Guide (SSS-012 / SSS-013)

This document covers running the SDK integration test suite locally and explains how integration tests run in CI.

---

## Overview

The project has two tiers of tests:

| Tier | Command | Requires backend? | Coverage |
|------|---------|-------------------|----------|
| **Unit tests** | `npm test` (in `sdk/`) | No | SDK logic, type safety |
| **Integration tests** | `npm run test:integration` (in `sdk/`) | Yes — live axum server | Full REST round-trips |

Integration tests exercise every `SSSClient` method against a real running backend, with an in-memory SQLite database.

---

## Running Locally

### 1. Start the backend

```bash
cd backend
DATABASE_URL=":memory:" \
BOOTSTRAP_API_KEY="sss_devtest000000000000000000000000000" \
PORT=9876 \
cargo run --release
```

Wait until you see the server listening message, or check:
```bash
curl http://127.0.0.1:9876/api/health
# → {"status":"ok"}
```

### 2. Run the integration tests

In a separate terminal:

```bash
cd sdk
SSS_TEST_BASE_URL="http://127.0.0.1:9876" \
SSS_TEST_API_KEY="sss_devtest000000000000000000000000000" \
npm run test:integration
```

Expected output: **26 tests pass** across 6 files (≤ 30 s timeout per test).

---

## Environment Variables

| Variable | Description | Default in CI |
|----------|-------------|---------------|
| `SSS_TEST_BASE_URL` | Base URL of the running backend | `http://127.0.0.1:9876` |
| `SSS_TEST_API_KEY` | Bootstrap API key (matches `BOOTSTRAP_API_KEY` used to start backend) | `sss_integrationtest000000000000000000` |
| `DATABASE_URL` | Backend database path; use `:memory:` for tests | `:memory:` |
| `BOOTSTRAP_API_KEY` | Initial API key seeded into the backend on startup | set to match `SSS_TEST_API_KEY` |
| `RATE_LIMIT_CAPACITY` | Token-bucket capacity; set high to avoid throttling in tests | `10000` |
| `RATE_LIMIT_RPS` | Token-bucket refill rate; set high to avoid throttling in tests | `1000` |
| `PORT` | Backend listen port | `9876` |

---

## Test File Breakdown

| File | Tests | Methods Covered |
|------|-------|-----------------|
| `health.integration.test.ts` | 1 | `health()` |
| `mint-burn-supply.integration.test.ts` | 7 | `mint()`, `burn()`, `getSupply()`, `getEvents()` |
| `compliance.integration.test.ts` | 7 | `addToBlacklist()`, `getBlacklist()`, blacklist enforcement on `mint()`, `getAuditLog()`, `removeFromBlacklist()` |
| `webhooks.integration.test.ts` | 4 | `addWebhook()`, `getWebhooks()`, `deleteWebhook()` |
| `apikeys.integration.test.ts` | 5 | `createApiKey()`, `listApiKeys()`, new key usage, `deleteApiKey()`, revoked key rejection |
| `auth.integration.test.ts` | 2 | Reject requests with missing key, reject requests with invalid key |

Total: **26 integration tests**

---

## CI Pipeline

Integration tests run in the `sdk-integration` CI job, which depends on the `backend` job passing first.

### Job flow

```
backend ──► sdk-integration
sdk     ──► (independent, unit tests only)
anchor  ──► (independent, Anchor build + test)
```

### What `sdk-integration` does

1. Checks out the repo and restores the Rust build cache.
2. Builds the backend in release mode (`cargo build --release`).
3. Starts the backend in the background with `BOOTSTRAP_API_KEY`, `DATABASE_URL=:memory:`, and a high rate-limit config.
4. Polls `http://127.0.0.1:9876/api/health` every second (up to 30 s) until the server responds.
5. Installs SDK npm dependencies.
6. Runs `npm run test:integration`.

### Key CI env vars (set in `.github/workflows/ci.yml`)

```yaml
BOOTSTRAP_API_KEY: sss_integrationtest000000000000000000
SSS_TEST_API_KEY:  sss_integrationtest000000000000000000
SSS_TEST_BASE_URL: http://127.0.0.1:9876
DATABASE_URL:      ":memory:"
RATE_LIMIT_CAPACITY: "10000"
RATE_LIMIT_RPS:      "1000"
PORT:              "9876"
```

---

## Vitest Configuration

The SDK uses two separate Vitest configs to keep unit and integration tests isolated:

| Config file | `npm` script | Targets |
|-------------|-------------|---------|
| `sdk/vitest.config.ts` | `npm test` | `tests/**` excluding `tests/integration/**` |
| `sdk/vitest.integration.config.ts` | `npm run test:integration` | `tests/integration/**` only, 30 s timeout |

This ensures `npm test` (used in the `sdk` CI job and local development) never requires a live backend.

---

## Troubleshooting

**Tests time out / fail to connect**

Check the backend is running and the port matches:
```bash
curl -sf http://127.0.0.1:9876/api/health || echo "backend not ready"
```

**401 Unauthorized**

Ensure `SSS_TEST_API_KEY` matches the `BOOTSTRAP_API_KEY` value used to start the backend. They must be identical.

**Rate-limit 429 errors**

Set `RATE_LIMIT_CAPACITY` and `RATE_LIMIT_RPS` to large values (e.g., `10000` / `1000`) so the test suite doesn't exhaust the token bucket.

**`cargo build` takes too long locally**

Use `cargo build --release` once; subsequent runs use the incremental cache. In CI, `Swatinem/rust-cache` caches the `target/` directory across runs.
