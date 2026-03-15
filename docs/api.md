# SSS Backend — API Reference

**Base URL:** `http://localhost:8080` (default)  
**Auth header:** `X-Api-Key: sss_<48-char hex>`  
**Content-Type:** `application/json` for all request bodies  
**Response envelope:**

```json
{
  "success": true | false,
  "data": <payload or null>,
  "error": "<message or null>"
}
```

---

## Health

### `GET /api/health`

Public endpoint. No authentication required.

**Response 200**

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "0.1.0",
    "timestamp": "2026-03-13T18:59:00Z"
  },
  "error": null
}
```

---

## Mint

### `POST /api/mint`

Record a stablecoin mint event. The recipient is checked against the blacklist before the event is persisted. On success, all registered `"mint"` (or `"all"`) webhooks are notified asynchronously.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token_mint` | string | ✓ | Solana token-mint public key |
| `amount` | u64 | ✓ | Token amount (raw units, must be > 0) |
| `recipient` | string | ✓ | Recipient wallet public key |
| `tx_signature` | string | ✗ | Solana transaction signature |

```json
{
  "token_mint": "So11111111111111111111111111111111111111112",
  "amount": 1000000,
  "recipient": "RecipientAddress123456789012345678901234567",
  "tx_signature": "5KtP9x2cZg7DnK1mHMT3fQ8uBpz4Wj6Yx9AvN2rELsS"
}
```

**Response 200 — success**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "token_mint": "So11111111111111111111111111111111111111112",
    "amount": 1000000,
    "recipient": "RecipientAddress123456789012345678901234567",
    "tx_signature": "5KtP9x2cZg7DnK1mHMT3fQ8uBpz4Wj6Yx9AvN2rELsS",
    "created_at": "2026-03-13T18:59:00Z"
  },
  "error": null
}
```

**Response 400** — missing field, zero amount, or blacklisted recipient  
**Response 401** — missing or invalid API key

---

## Burn

### `POST /api/burn`

Record a stablecoin burn event. On success, all registered `"burn"` (or `"all"`) webhooks are notified asynchronously.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token_mint` | string | ✓ | Solana token-mint public key |
| `amount` | u64 | ✓ | Token amount (raw units, must be > 0) |
| `source` | string | ✓ | Source wallet public key |
| `tx_signature` | string | ✗ | Solana transaction signature |

```json
{
  "token_mint": "So11111111111111111111111111111111111111112",
  "amount": 500000,
  "source": "SourceAddress123456789012345678901234567890",
  "tx_signature": "3Yz8AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AB"
}
```

**Response 200 — success**

```json
{
  "success": true,
  "data": {
    "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "token_mint": "So11111111111111111111111111111111111111112",
    "amount": 500000,
    "source": "SourceAddress123456789012345678901234567890",
    "tx_signature": "3Yz8AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AB",
    "created_at": "2026-03-13T18:59:00Z"
  },
  "error": null
}
```

**Response 400** — missing field or zero amount  
**Response 401** — missing or invalid API key

---

## Supply

### `GET /api/supply`

Return aggregate supply figures. Optionally filter by token mint.

**Query parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token_mint` | string | ✗ | Filter to a specific mint; omit for global totals |

**Example**

```
GET /api/supply?token_mint=So11111111111111111111111111111111111111112
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "token_mint": "So11111111111111111111111111111111111111112",
    "total_minted": 1500000,
    "total_burned": 500000,
    "circulating_supply": 1000000
  },
  "error": null
}
```

`circulating_supply = total_minted − total_burned` (saturating subtraction; never negative).  
When no `token_mint` is provided, `token_mint` in the response is `"all"`.

---

## Events

### `GET /api/events`

List mint and burn events, most-recent first.

**Query parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `token_mint` | string | ✗ | all | Filter by mint |
| `limit` | u32 | ✗ | 100 | Max events per type (mint, burn) |

**Response 200**

```json
{
  "success": true,
  "data": {
    "mint_events": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "token_mint": "So11111111111111111111111111111111111111112",
        "amount": 1000000,
        "recipient": "RecipientAddress123456789012345678901234567",
        "tx_signature": "5KtP9x2cZg7DnK1mHMT3fQ8uBpz4Wj6Yx9AvN2rELsS",
        "created_at": "2026-03-13T18:59:00Z"
      }
    ],
    "burn_events": [
      {
        "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        "token_mint": "So11111111111111111111111111111111111111112",
        "amount": 500000,
        "source": "SourceAddress123456789012345678901234567890",
        "tx_signature": "3Yz8AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AB",
        "created_at": "2026-03-13T18:59:00Z"
      }
    ]
  },
  "error": null
}
```

---

## Compliance

### `GET /api/compliance/blacklist`

Return all blacklisted addresses, most-recent first.

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "address": "BlockedAddress12345678901234567890123456789",
      "reason": "Sanctioned entity",
      "created_at": "2026-03-13T18:59:00Z"
    }
  ],
  "error": null
}
```

---

### `POST /api/compliance/blacklist`

Add an address to the blacklist. Idempotent — re-adding an existing address updates it.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | string | ✓ | Wallet public key to block |
| `reason` | string | ✓ | Human-readable justification |

```json
{
  "address": "BlockedAddress12345678901234567890123456789",
  "reason": "Sanctioned entity"
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "...",
    "address": "BlockedAddress12345678901234567890123456789",
    "reason": "Sanctioned entity",
    "created_at": "2026-03-13T18:59:00Z"
  },
  "error": null
}
```

**Side effect:** writes a `BLACKLIST_ADD` entry to the audit log.

---

### `GET /api/compliance/audit`

Return the full audit log, most-recent first.

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "action": "MINT",
      "address": "RecipientAddress123456789012345678901234567",
      "details": "Minted 1000000 tokens on mint So11111111111111111111111111111111111111112",
      "created_at": "2026-03-13T18:59:00Z"
    }
  ],
  "error": null
}
```

**Recorded actions**

| Action | Trigger |
|--------|---------|
| `MINT` | Successful `POST /api/mint` |
| `MINT_BLOCKED` | Mint rejected due to blacklisted recipient |
| `BURN` | Successful `POST /api/burn` |
| `BLACKLIST_ADD` | `POST /api/compliance/blacklist` |

---

## Webhooks

### `GET /api/webhooks`

List all registered webhooks.

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "url": "https://example.com/webhook",
      "events": ["mint", "burn"],
      "created_at": "2026-03-13T18:59:00Z"
    }
  ],
  "error": null
}
```

---

### `POST /api/webhooks`

Register a new webhook URL.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✓ | HTTPS endpoint to POST events to |
| `events` | string[] | ✓ | Event kinds: `"mint"`, `"burn"`, and/or `"all"` |

```json
{
  "url": "https://example.com/webhook",
  "events": ["mint", "burn"]
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "...",
    "url": "https://example.com/webhook",
    "events": ["mint", "burn"],
    "created_at": "2026-03-13T18:59:00Z"
  },
  "error": null
}
```

**Response 400** — missing `url` or empty `events` list

---

### `DELETE /api/webhooks/:id`

Delete a webhook by its ID.

**Response 200**

```json
{
  "success": true,
  "data": { "deleted": true, "id": "..." },
  "error": null
}
```

**Response 404** — webhook not found

---

### Webhook Payload Format

When a mint or burn event occurs, all matching webhook URLs receive:

```json
{
  "event": "mint",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "token_mint": "So11111111111111111111111111111111111111112",
    "amount": 1000000,
    "recipient": "RecipientAddress123456789012345678901234567",
    "tx_signature": "5KtP9x2cZg7DnK1mHMT3fQ8uBpz4Wj6Yx9AvN2rELsS",
    "created_at": "2026-03-13T18:59:00Z"
  },
  "delivered_at": "2026-03-13T18:59:00Z"
}
```

For burn events, `data` contains `source` instead of `recipient`.

**Delivery semantics:**
- Fire-and-forget (one `tokio::spawn` per URL)
- 5-second per-request timeout
- No automatic retries; implement retry logic on the consumer side
- Non-2xx responses are logged as warnings; errors are logged but do not affect the original API response

---

## API Key Management

### `GET /api/admin/keys`

List all API keys. Key values are redacted — only the first 8 characters (`key_prefix`) are returned.

**Response 200**

```json
{
  "success": true,
  "data": {
    "api_keys": [
      {
        "id": "...",
        "label": "production",
        "key_prefix": "sss_boot",
        "created_at": "2026-03-13T18:59:00Z"
      }
    ]
  },
  "error": null
}
```

---

### `POST /api/admin/keys`

Create a new API key. The full key value is returned **only once** at creation time.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | ✗ | Human-readable label (defaults to `"unnamed"`) |

```json
{ "label": "production" }
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "...",
    "key": "sss_<48 hex chars>",
    "label": "production",
    "created_at": "2026-03-13T18:59:00Z"
  },
  "error": null
}
```

> ⚠️ Store the `key` value immediately. It cannot be retrieved again.

---

### `DELETE /api/admin/keys/:id`

Delete an API key by its ID. The key is immediately invalid for future requests.

**Response 200**

```json
{
  "success": true,
  "data": { "deleted": true },
  "error": null
}
```

**Response 404** — key not found

---

## CDP (Collateral Debt Position)

> Added in SSS-053. Prices are fetched live from [Pyth Hermes v2](https://hermes.pyth.network/).
> All three endpoints require a valid `X-Api-Key` header.

### `GET /api/cdp/collateral-types`

Returns all supported collateral mints with live Pyth USD prices and risk parameters.

**Response 200**

```json
{
  "success": true,
  "data": {
    "collateral_types": [
      {
        "name": "Solana",
        "mint": "So11111111111111111111111111111111111111112",
        "price_usd": 142.37,
        "liquidation_threshold": 0.80,
        "min_collateral_ratio": 1.50
      },
      {
        "name": "Bitcoin (Wrapped)",
        "mint": "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
        "price_usd": 84210.50,
        "liquidation_threshold": 0.80,
        "min_collateral_ratio": 1.50
      },
      {
        "name": "Ethereum (Wrapped)",
        "mint": "2FpyTwYzMkjeS168FMoAN8R2QoAntFZo9Mk4uDuyVe1r",
        "price_usd": 3941.22,
        "liquidation_threshold": 0.80,
        "min_collateral_ratio": 1.50
      }
    ]
  },
  "error": null
}
```

---

### `GET /api/cdp/position/:wallet`

Returns the CDP health metrics for a given wallet address. The `wallet` path parameter must be a valid base-58 Solana public key (32–44 characters).

**Path parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `wallet` | string | Solana wallet public key (base-58) |

**Response 200**

```json
{
  "success": true,
  "data": {
    "wallet": "So11111111111111111111111111111111111111112",
    "collateral_mint": "So11111111111111111111111111111111111111112",
    "collateral_amount": 5.3,
    "collateral_usd": 754.56,
    "debt_usd": 320.00,
    "collateral_ratio": 2.358,
    "health_factor": 1.887,
    "liquidation_price": 75.47,
    "max_borrowable_usd": 603.65,
    "is_liquidatable": false
  },
  "error": null
}
```

| Field | Description |
|-------|-------------|
| `collateral_ratio` | `collateral_usd / debt_usd` |
| `health_factor` | `(collateral_usd × liquidation_threshold) / debt_usd`; position is safe when ≥ 1.0 |
| `liquidation_price` | Spot price (USD) at which the position becomes liquidatable |
| `max_borrowable_usd` | Maximum additional debt allowed: `collateral_usd × liquidation_threshold` |
| `is_liquidatable` | `true` when `collateral_ratio < min_collateral_ratio` |

**Response 400** — wallet address length outside 32–44 characters.

---

### `POST /api/cdp/simulate`

Preview borrow/liquidation risk for a given collateral amount and requested borrow without any on-chain state.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `collateral_mint` | string | ✓ | One of the supported collateral mints from `/api/cdp/collateral-types` |
| `collateral_amount` | f64 | ✓ | Collateral quantity (token units, must be > 0) |
| `borrow_amount` | f64 | ✓ | Desired borrow in USD (≥ 0) |

```json
{
  "collateral_mint": "So11111111111111111111111111111111111111112",
  "collateral_amount": 10.0,
  "borrow_amount": 500.0
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "collateral_usd": 1423.70,
    "debt_usd": 500.00,
    "collateral_ratio": 2.847,
    "health_factor": 2.278,
    "liquidation_price": 62.50,
    "max_borrowable_usd": 1138.96,
    "is_liquidatable": false,
    "would_be_valid": true
  },
  "error": null
}
```

| Field | Description |
|-------|-------------|
| `would_be_valid` | `true` when `collateral_ratio ≥ min_collateral_ratio` or `borrow_amount == 0` |

**Response 400** — unsupported mint, `collateral_amount ≤ 0`, or `borrow_amount < 0`.

---

## Error Responses

All errors follow the standard envelope with `success: false`:

```json
{
  "success": false,
  "data": null,
  "error": "Recipient <address> is blacklisted"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad request — validation failure or compliance rejection |
| 401 | Unauthorized — missing or invalid `X-Api-Key` |
| 404 | Not found |
| 500 | Internal server error |
