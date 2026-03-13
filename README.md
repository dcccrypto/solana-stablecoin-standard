# Solana Stablecoin Standard (SSS) — Backend

A Rust/Axum REST API for recording, querying, and streaming stablecoin mint and burn events on Solana. Provides compliance tooling (blacklist, audit log), API-key authentication, and webhook delivery.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Webhooks](#webhooks)
- [Compliance](#compliance)
- [Development](#development)

---

## Quick Start

### Prerequisites

- Rust 1.75+ (stable)
- SQLite (linked automatically via `rusqlite`)

### Run

```bash
cd backend
cargo run
```

The server listens on port **8080** by default. Override with `PORT=9000 cargo run`.

The SQLite database is created at `./sss.db`. Override with `DATABASE_URL=/path/to/db.sqlite`.

### First API Key

On a fresh database you must bootstrap your first key directly:

```bash
# One-shot: create bootstrap key via the admin endpoint
# (requires an existing key — seed one via the DB or use the test helper)
sqlite3 sss.db "INSERT INTO api_keys (id, key, label, created_at) VALUES (lower(hex(randomblob(16))), 'sss_bootstrapkey000000000000000000000000000000000000', 'bootstrap', datetime('now'));"
```

Then use `POST /api/admin/keys` with that key to create permanent keys and delete the bootstrap key.

---

## Architecture

```
backend/
├── src/
│   ├── main.rs          # Router, server boot, integration tests
│   ├── auth.rs          # API-key middleware (X-Api-Key header)
│   ├── db.rs            # SQLite via rusqlite (Mutex<Connection>)
│   ├── error.rs         # AppError → HTTP status mapping
│   ├── models.rs        # Shared request/response structs
│   ├── webhook.rs       # Fire-and-forget HTTP POST dispatcher
│   └── routes/
│       ├── health.rs    # GET /api/health  (public)
│       ├── mint.rs      # POST /api/mint
│       ├── burn.rs      # POST /api/burn
│       ├── supply.rs    # GET /api/supply
│       ├── events.rs    # GET /api/events
│       ├── webhooks.rs  # CRUD /api/webhooks
│       ├── compliance.rs# /api/compliance/*
│       └── apikeys.rs   # /api/admin/keys
```

**Storage:** SQLite with six tables — `api_keys`, `mint_events`, `burn_events`, `blacklist`, `audit_log`, `webhooks`.

**Auth:** Every route except `GET /api/health` requires an `X-Api-Key` header validated against the `api_keys` table.

**Webhooks:** Delivered asynchronously via `tokio::spawn` after each mint/burn. Best-effort; failures are logged and do not affect the response.

---

## Authentication

All protected endpoints require:

```
X-Api-Key: sss_<48-char hex>
```

Missing or invalid keys return `401 Unauthorized`.

---

## API Reference

Full reference: [`docs/api.md`](docs/api.md)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | ✗ | Health check |
| POST | `/api/mint` | ✓ | Record a mint event |
| POST | `/api/burn` | ✓ | Record a burn event |
| GET | `/api/supply` | ✓ | Query circulating supply |
| GET | `/api/events` | ✓ | List mint + burn events |
| GET | `/api/compliance/blacklist` | ✓ | List blacklisted addresses |
| POST | `/api/compliance/blacklist` | ✓ | Add an address to the blacklist |
| GET | `/api/compliance/audit` | ✓ | Retrieve the audit log |
| GET | `/api/webhooks` | ✓ | List registered webhooks |
| POST | `/api/webhooks` | ✓ | Register a webhook |
| DELETE | `/api/webhooks/:id` | ✓ | Delete a webhook |
| GET | `/api/admin/keys` | ✓ | List API keys (redacted) |
| POST | `/api/admin/keys` | ✓ | Create an API key |
| DELETE | `/api/admin/keys/:id` | ✓ | Delete an API key |

---

## Webhooks

Register a URL to receive JSON POSTs whenever a mint or burn event is recorded.

**Envelope:**

```json
{
  "event": "mint",
  "data": { /* MintEvent or BurnEvent */ },
  "delivered_at": "2026-03-13T18:59:00Z"
}
```

- **Delivery:** fire-and-forget, one `tokio::spawn` per URL per event.
- **Timeout:** 5 seconds per request.
- **Retries:** none (best-effort). Implement your own retry logic if needed.
- **Event filter:** subscribe to `"mint"`, `"burn"`, or `"all"`.

---

## Compliance

- **Blacklist:** Mint attempts to a blacklisted recipient are rejected with `400` and written to the audit log.
- **Audit log:** Every mint, burn, and blacklist-add action is recorded with action type, address, and details.

---

## Development

```bash
# Run tests (in-memory SQLite, no binary needed)
cd backend && cargo test

# Lint
cargo clippy -- -D warnings

# Format
cargo fmt
```

All 11 tests run against an in-memory SQLite database and exercise auth, mint, burn, supply, events, blacklist, webhooks, and API key management.
