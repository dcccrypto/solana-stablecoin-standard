# Backend API Reference

Base URL: `http://localhost:3000` (configurable via `PORT` env var).

All request/response bodies are JSON. All token state is read from and written to the Solana blockchain — the backend is stateless.

---

## Health

### `GET /health`

Liveness check. Always returns 200.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-03-12T21:00:00.000Z"
}
```

### `GET /ready`

Readiness check. Verifies Solana RPC connectivity and returns the configured mint.

**Response (200):**

```json
{
  "status": "ready",
  "solana": { "solana-core": "2.2.1", "feature-set": 1234567890 },
  "mint": "7NDka...",
  "timestamp": "2026-03-12T21:00:00.000Z"
}
```

**Response (503):** RPC unreachable.

```json
{
  "status": "not ready",
  "error": "fetch failed"
}
```

---

## Mint / Burn

### `POST /api/v1/mint`

Mint tokens to a recipient. Creates the ATA if it doesn't exist.

**Request:**

```json
{
  "recipient": "<wallet-public-key>",
  "amount": "1000000"
}
```

- `recipient` (required): Wallet public key. The ATA is derived automatically.
- `amount` (required): Raw units as a string (to avoid precision issues with large numbers).

**Response (200):**

```json
{
  "txSignature": "5DJwAPNtmeSCsUBp9AHzD81C9HkKWAohmpNRfr3CACEDSzF5..."
}
```

**Errors:**
- `400`: Missing `recipient` or `amount`, or invalid public key.
- `500`: Transaction failed (e.g., signer is not the mint authority).

### `POST /api/v1/burn`

Burn tokens from the backend authority's ATA.

**Request:**

```json
{
  "amount": "500000"
}
```

**Response (200):**

```json
{
  "txSignature": "3iTzsejFP1mzYyCNCkLvuWenz43TNxmVNiBPN8u4yBSR5..."
}
```

### `GET /api/v1/supply`

Fetch total supply from the blockchain.

**Response:**

```json
{
  "raw": "10000000",
  "uiAmount": 10.0,
  "uiAmountString": "10.000000",
  "decimals": 6
}
```

> **Precision note**: `uiAmount` is a JavaScript `number` and loses precision for large supplies (> 2^53 raw units). Use `uiAmountString` for display.

### `GET /api/v1/balance/:wallet`

Fetch token balance for a wallet.

**Path params:**
- `wallet`: Wallet public key.

**Response:**

```json
{
  "wallet": "Dkvvh...",
  "ata": "aw1cQ...",
  "raw": "5000000",
  "uiAmount": 5.0,
  "uiAmountString": "5.000000",
  "exists": true
}
```

If the ATA doesn't exist, `exists` is `false` and balances are `0`.

---

## Token Management

### `GET /api/v1/status`

On-chain mint status.

**Response:**

```json
{
  "mint": "7NDka...",
  "supply": {
    "raw": "10000000",
    "uiAmount": 10.0,
    "uiAmountString": "10.000000",
    "decimals": 6
  },
  "mintAuthority": "Gxyz...",
  "freezeAuthority": "Gxyz..."
}
```

Authorities are `null` if revoked.

### `POST /api/v1/freeze`

Freeze a token account.

**Request:**

```json
{
  "tokenAccount": "<token-account-public-key>"
}
```

**Response:**

```json
{
  "txSignature": "2Bjmw..."
}
```

### `POST /api/v1/thaw`

Thaw a frozen token account.

**Request:**

```json
{
  "tokenAccount": "<token-account-public-key>"
}
```

### `POST /api/v1/set-authority`

Change an on-chain authority.

**Request:**

```json
{
  "type": "freeze",
  "newAuthority": "<public-key-or-none>"
}
```

- `type` (required): One of `mint`, `freeze`, `metadata`, `metadata-pointer`, `pause`, `permanent-delegate`, `close-mint`, `interest-rate`.
- `newAuthority`: Public key string, or `"none"` to revoke.

### `GET /api/v1/audit-log`

Fetch recent transaction signatures involving the mint.

**Query params:**
- `limit` (optional, default 20, max 1000)

**Response:**

```json
[
  {
    "signature": "abc123...",
    "slot": 345678901,
    "err": null,
    "blockTime": "2026-03-12T21:00:00.000Z"
  }
]
```

---

## Compliance (SSS-2)

These endpoints require `TRANSFER_HOOK_PROGRAM_ID` to be set. They manage the on-chain blacklist via the transfer hook program.

### `POST /api/v1/compliance/blacklist`

Add a wallet to the blacklist.

**Request:**

```json
{
  "wallet": "<wallet-public-key>",
  "reason": "OFAC match"
}
```

- `wallet` (required): The wallet to blacklist.
- `reason` (optional): Stored on-chain in the BlacklistEntry PDA for audit compliance, and emitted in the `WalletBlacklisted` event.

**Response:**

```json
{
  "txSignature": "4kLmN..."
}
```

### `DELETE /api/v1/compliance/blacklist/:wallet`

Remove a wallet from the blacklist.

**Path params:**
- `wallet`: Wallet public key.

**Query params:**
- `reason` (optional): Reason for removal.

**Response:**

```json
{
  "txSignature": "7pQrS..."
}
```

### `GET /api/v1/compliance/blacklist/:wallet`

Check whether a wallet is blacklisted.

**Response:**

```json
{
  "wallet": "Dkvvh...",
  "pda": "BLpda...",
  "blocked": false,
  "reason": "OFAC match"
}
```

The `reason` field is present when the entry exists and contains the on-chain reason string from the BlacklistEntry PDA.

---

## Webhooks

Register HTTP endpoints to receive real-time notifications when the event listener detects new on-chain transactions involving the mint.

### Events

| Event | Description |
|-------|-------------|
| `transaction.confirmed` | Successful transaction involving the mint |
| `transaction.failed` | Failed transaction involving the mint |
| `*` | Wildcard — all events |

### `POST /api/v1/webhooks`

Register a webhook.

**Request:**

```json
{
  "url": "https://your-server.com/webhook",
  "events": ["transaction.confirmed"],
  "secret": "optional-shared-secret"
}
```

If `secret` is provided, it's sent as `x-webhook-secret` header on every delivery.

**Response (201):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://your-server.com/webhook",
  "events": ["transaction.confirmed"],
  "active": true,
  "createdAt": "2026-03-12T21:00:00.000Z"
}
```

### `GET /api/v1/webhooks`

List all registered webhooks.

**Response:** Array of webhook objects.

### `GET /api/v1/webhooks/:id`

Get a specific webhook.

### `GET /api/v1/webhooks/:id/deliveries`

Get delivery history for a webhook.

**Response:**

```json
[
  {
    "webhookId": "550e8400...",
    "event": "transaction.confirmed",
    "payload": { "signature": "abc...", "slot": 123, "mint": "7NDka..." },
    "attempt": 1,
    "status": "delivered",
    "httpStatus": 200,
    "timestamp": "2026-03-12T21:00:05.000Z"
  }
]
```

### `DELETE /api/v1/webhooks/:id`

Remove a webhook.

**Response:**

```json
{
  "deleted": true
}
```

### Webhook Delivery Format

Each delivery is an HTTP POST to the registered URL:

```json
{
  "event": "transaction.confirmed",
  "payload": {
    "signature": "abc123...",
    "slot": 345678901,
    "err": null,
    "blockTime": 1710280800,
    "mint": "7NDka..."
  },
  "timestamp": "2026-03-12T21:00:05.000Z"
}
```

Deliveries retry with exponential backoff: `WEBHOOK_RETRY_BASE_MS * 2^(attempt-1)`, up to `WEBHOOK_MAX_RETRIES` attempts.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | Yes | — | Solana RPC endpoint |
| `SOLANA_MINT_ADDRESS` | Yes | — | On-chain mint public key |
| `TOKEN_PROGRAM` | No | `spl-token-2022` | `spl-token` or `spl-token-2022` |
| `SOLANA_KEYPAIR_PATH` | One of PATH/BASE64 | — | Filesystem path to keypair JSON |
| `SOLANA_KEYPAIR_BASE64` | One of PATH/BASE64 | — | Base64-encoded secret key |
| `TRANSFER_HOOK_PROGRAM_ID` | No | — | Enables compliance endpoints |
| `BLACKLIST_ADMIN_KEYPAIR_PATH` | No | — | Blacklist admin (defaults to main authority) |
| `PORT` | No | `3000` | HTTP listen port |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` / `silent` |
| `EVENT_POLL_INTERVAL_MS` | No | `5000` | Event listener poll frequency |
| `WEBHOOK_MAX_RETRIES` | No | `5` | Max delivery retries |
| `WEBHOOK_RETRY_BASE_MS` | No | `1000` | Base delay for exponential backoff |

---

## Error Format

All error responses follow:

```json
{
  "error": "Human-readable error message"
}
```

Common HTTP status codes:
- `400` — Bad request (missing/invalid parameters).
- `404` — Resource not found (webhook ID).
- `500` — Internal error (transaction failure, RPC error).
- `503` — Service unavailable (readiness check failed).
