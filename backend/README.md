# SSS Backend Service

REST API backend for the **Solana Stablecoin Standard** — wraps the `sss-token-sdk` and exposes mint/burn lifecycle, token management, SSS-2 compliance, on-chain event monitoring, and webhook notifications over HTTP.

All token state lives on-chain. The backend is stateless except for an in-memory webhook registry (runtime config).

## Quick Start

```bash
# 1. Build the SDK (peer dependency)
cd ../sdk && npm install && npm run build && cd ../backend

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env — set SOLANA_MINT_ADDRESS, SOLANA_KEYPAIR_PATH, etc.

# 4. Run
npm run dev
```

The server starts on `http://localhost:3000` by default.

## Docker

```bash
# From repo root
docker compose -f backend/docker-compose.yml up --build
```

The `Dockerfile` builds the SDK and backend in a multi-stage build, producing a slim production image.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SOLANA_RPC_URL` | Yes | — | Solana RPC endpoint |
| `SOLANA_MINT_ADDRESS` | Yes | — | On-chain mint public key |
| `TOKEN_PROGRAM` | No | `spl-token-2022` | `spl-token` or `spl-token-2022` |
| `SOLANA_KEYPAIR_PATH` | One of `PATH`/`BASE64` | — | Filesystem path to keypair JSON |
| `SOLANA_KEYPAIR_BASE64` | One of `PATH`/`BASE64` | — | Base64-encoded secret key (for containers) |
| `TRANSFER_HOOK_PROGRAM_ID` | No | — | Transfer hook program ID (enables SSS-2 compliance) |
| `BLACKLIST_ADMIN_KEYPAIR_PATH` | No | — | Blacklist admin keypair (defaults to main authority) |
| `PORT` | No | `3000` | HTTP listen port |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`, `silent`) |
| `EVENT_POLL_INTERVAL_MS` | No | `5000` | How often the event listener polls for new transactions |
| `WEBHOOK_MAX_RETRIES` | No | `5` | Max delivery attempts per webhook event |
| `WEBHOOK_RETRY_BASE_MS` | No | `1000` | Base delay for exponential backoff (ms) |

## API Reference

All data endpoints are under `/api/v1`. Health endpoints are at the root.

---

### Health

#### `GET /health`

Liveness check. Always returns 200.

**Response:**

```json
{ "status": "ok", "timestamp": "2026-03-12T21:00:00.000Z" }
```

#### `GET /ready`

Readiness check. Verifies Solana RPC connectivity.

**Response (200):**

```json
{
  "status": "ready",
  "solana": { "solana-core": "2.2.1", "feature-set": 1234567 },
  "mint": "7NDka...",
  "timestamp": "2026-03-12T21:00:00.000Z"
}
```

**Response (503):** If RPC is unreachable.

---

### Mint / Burn

#### `POST /api/v1/mint`

Mint tokens to a recipient. Creates the ATA if it doesn't exist.

**Body:**

```json
{ "recipient": "<wallet-pubkey>", "amount": "1000000" }
```

**Response:**

```json
{ "txSignature": "5DJwA..." }
```

#### `POST /api/v1/burn`

Burn tokens from the authority's ATA.

**Body:**

```json
{ "amount": "500000" }
```

**Response:**

```json
{ "txSignature": "3iTzs..." }
```

#### `GET /api/v1/supply`

Fetch total supply from the blockchain.

**Response:**

```json
{ "raw": "1000000", "uiAmount": 1.0, "uiAmountString": "1.000000", "decimals": 6 }
```

> **Precision note**: `uiAmount` is a JavaScript `number` and loses precision for large supplies (> 2^53 raw units). Use `uiAmountString` for display.

#### `GET /api/v1/balance/:wallet`

Fetch balance for a specific wallet.

**Response:**

```json
{
  "wallet": "Dkvvh...",
  "ata": "aw1cQ...",
  "raw": "500000",
  "uiAmount": 0.5,
  "uiAmountString": "0.500000",
  "exists": true
}
```

---

### Token Management

#### `GET /api/v1/status`

On-chain mint status: supply, authorities.

**Response:**

```json
{
  "mint": "7NDka...",
  "supply": { "raw": "1000000", "uiAmount": 1.0, "uiAmountString": "1.000000", "decimals": 6 },
  "mintAuthority": "Gxyz...",
  "freezeAuthority": "Gxyz..."
}
```

#### `POST /api/v1/freeze`

Freeze a token account.

**Body:**

```json
{ "tokenAccount": "<token-account-pubkey>" }
```

#### `POST /api/v1/thaw`

Thaw a frozen token account.

**Body:**

```json
{ "tokenAccount": "<token-account-pubkey>" }
```

#### `POST /api/v1/set-authority`

Change an on-chain authority.

**Body:**

```json
{ "type": "freeze", "newAuthority": "<pubkey-or-none>" }
```

Supported types: `mint`, `freeze`, `metadata`, `metadata-pointer`, `pause`, `permanent-delegate`, `transfer-fee-config`, `close-mint`, `interest-rate`.

Pass `"none"` as `newAuthority` to revoke.

#### `GET /api/v1/audit-log`

Fetch recent transaction signatures involving the mint directly from the blockchain.

**Query params:** `?limit=20` (default 20, max 1000)

**Response:**

```json
[
  { "signature": "abc123", "slot": 12345, "err": null, "blockTime": "2026-03-12T21:00:00.000Z" }
]
```

---

### Compliance (SSS-2)

Requires `TRANSFER_HOOK_PROGRAM_ID` to be set. These endpoints manage the on-chain blacklist via the transfer hook program.

#### `POST /api/v1/compliance/blacklist`

Add a wallet to the blacklist.

**Body:**

```json
{ "wallet": "<wallet-pubkey>", "reason": "OFAC match" }
```

**Response:**

```json
{ "txSignature": "2Bjmw..." }
```

#### `DELETE /api/v1/compliance/blacklist/:wallet`

Remove a wallet from the blacklist.

**Query params:** `?reason=cleared` (optional, for logging)

#### `GET /api/v1/compliance/blacklist/:wallet`

Check whether a wallet is blacklisted.

**Response:**

```json
{ "wallet": "Dkvvh...", "pda": "BLpda...", "blocked": false, "reason": "OFAC match" }
```

The `reason` field is present when the entry exists and contains the on-chain reason string from the BlacklistEntry PDA.

---

### Webhooks

Register HTTP endpoints to receive real-time notifications when the event listener detects new on-chain transactions.

#### Events

| Event | Description |
|---|---|
| `transaction.confirmed` | A successful transaction involving the mint |
| `transaction.failed` | A failed transaction involving the mint |
| `*` | Wildcard — receive all events |

#### `POST /api/v1/webhooks`

Register a new webhook.

**Body:**

```json
{
  "url": "https://your-server.com/webhook",
  "events": ["transaction.confirmed"],
  "secret": "optional-shared-secret"
}
```

If `secret` is provided, it's sent as the `x-webhook-secret` header on every delivery.

**Response (201):**

```json
{
  "id": "uuid",
  "url": "https://your-server.com/webhook",
  "events": ["transaction.confirmed"],
  "active": true,
  "createdAt": "2026-03-12T21:00:00.000Z"
}
```

#### `GET /api/v1/webhooks`

List all registered webhooks.

#### `GET /api/v1/webhooks/:id`

Get a specific webhook.

#### `GET /api/v1/webhooks/:id/deliveries`

Get delivery history for a webhook (attempts, statuses, errors).

#### `DELETE /api/v1/webhooks/:id`

Remove a webhook.

**Delivery format** (POST to your URL):

```json
{
  "event": "transaction.confirmed",
  "payload": {
    "signature": "abc123",
    "slot": 12345,
    "err": null,
    "blockTime": 1710280800,
    "mint": "7NDka..."
  },
  "timestamp": "2026-03-12T21:00:00.000Z"
}
```

Deliveries retry with exponential backoff (`WEBHOOK_RETRY_BASE_MS * 2^(attempt-1)`) up to `WEBHOOK_MAX_RETRIES` times.

---

## Architecture

```
backend/
  src/
    index.ts            Entry point — loads config, starts server + event listener
    app.ts              Express app factory with dependency injection
    config.ts           Environment-based config with validation
    logger.ts           Pino structured logger
    solana.ts           SDK initialization (Connection + SolanaStablecoin)
    store.ts            In-memory webhook registry (no database)
    types.ts            Webhook-related types
    middleware/
      error-handler.ts  Global error handler
    routes/
      health.ts         GET /health, GET /ready
      mint.ts           POST /mint, POST /burn, GET /supply, GET /balance/:wallet
      token.ts          GET /status, POST /freeze, POST /thaw, POST /set-authority, GET /audit-log
      compliance.ts     Blacklist CRUD (SSS-2)
      webhooks.ts       Webhook CRUD + delivery history
    services/
      mint-burn.ts      Thin orchestration around SDK mint/burn
      compliance.ts     Blacklist operations via SDK compliance module
      event-listener.ts Polls chain for new txs, dispatches to webhooks
      webhook.ts        HTTP delivery with exponential-backoff retries
```

### Design Decisions

- **No database** — the blockchain is the source of truth. The only in-memory state is the webhook registry, which is runtime configuration.
- **No authentication** — the API is open. Add your own auth layer (reverse proxy, API gateway) if needed.
- **Dependency injection** — `createApp()` accepts all dependencies, making it easy to test with mocks (no Solana validator needed for unit tests).
- **Structured logging** — Pino produces JSON in production, pretty-prints in development.

## Tests

```bash
npm test
```

Tests use mock Solana SDK — no validator required. They cover all HTTP endpoints, request validation, and the webhook store.

## Development

```bash
npm run dev        # ts-node, hot-reload not included (add nodemon if desired)
npm run build      # compile to dist/
npm start          # run compiled JS
```
