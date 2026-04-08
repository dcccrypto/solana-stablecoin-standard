<p align="center">
  <img src="https://img.shields.io/badge/Rust-2021-orange?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Axum-0.7-blue?style=for-the-badge" alt="Axum" />
  <img src="https://img.shields.io/badge/SQLite-embedded-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
</p>

# SSS Backend

**Rust/axum REST API for the Solana Stablecoin Standard.**

Off-chain tracking, compliance management, audit logging, webhook dispatch, and real-time WebSocket event streaming for SSS stablecoins.

---

## Features

- Mint/burn event recording and supply tracking
- Compliance blacklist management with audit log
- API key authentication with role-based access (admin/standard)
- Token-bucket rate limiting with `Retry-After` headers
- Webhook dispatch with HMAC-SHA256 signature verification
- Real-time WebSocket event stream
- Travel rule record management
- Circuit breaker status tracking
- Embedded SQLite (zero external dependencies)

---

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
```

The server starts on `http://localhost:3000`.

### From Source

```bash
cargo build --release
./target/release/sss-backend
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `DATABASE_URL` | `sss.db` | SQLite database path |
| `API_KEY` | - | Default admin API key |
| `RUST_LOG` | `info` | Log level filter |

---

## API Endpoints

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Health check |

### Supply & Events

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/mint` | Yes | Record a mint event |
| `POST` | `/api/burn` | Yes | Record a burn event |
| `GET` | `/api/supply` | Yes | Get current supply stats |
| `GET` | `/api/events` | Yes | List mint/burn events (paginated) |

### Compliance

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/compliance/blacklist` | Yes | List blacklisted addresses |
| `POST` | `/api/compliance/blacklist` | Yes | Add address to blacklist |
| `DELETE` | `/api/compliance/blacklist/:addr` | Admin | Remove from blacklist |
| `GET` | `/api/compliance/audit` | Yes | Query audit log |

### Travel Rule

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/travel-rule/records` | Yes | Query travel rule records |
| `POST` | `/api/travel-rule/records` | Yes | Create travel rule record |

### Circuit Breaker

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/circuit-breaker/status` | Yes | Get circuit breaker state |
| `POST` | `/api/circuit-breaker/trigger` | Admin | Trigger circuit breaker |
| `POST` | `/api/circuit-breaker/release` | Admin | Release circuit breaker |

### Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/webhooks` | Admin | List webhook subscriptions |
| `POST` | `/api/webhooks` | Admin | Register new webhook |
| `DELETE` | `/api/webhooks/:id` | Admin | Remove webhook |

### WebSocket

| Path | Description |
|---|---|
| `/ws/events` | Real-time event stream (mint, burn, compliance changes) |

---

## Authentication

All authenticated endpoints require an `X-API-Key` header:

```bash
curl -H "X-API-Key: your-key-here" http://localhost:3000/api/supply
```

Admin endpoints (blacklist removal, webhooks, circuit breaker control) require an admin-role API key.

---

## Webhook Signatures

Outbound webhooks include an HMAC-SHA256 signature in the `X-SSS-Signature` header. Verify with:

```
HMAC-SHA256(webhook_secret, request_body)
```

---

## Development

```bash
# Build
cargo build

# Run tests
cargo test

# Lint (CI enforces zero warnings)
cargo clippy -- -D warnings

# Run with debug logging
RUST_LOG=debug cargo run
```

---

## License

Apache 2.0
