# SSS Indexer Integration Guide

> Covers Helius, Shyft, Triton, and custom indexer setups.

---

## Quick Start

1. **Register a webhook** with the SSS backend.
2. **Configure your indexer** to watch SSS program addresses.
3. **Parse event payloads** using the SSS Event Schema v1 (see [EVENT-SCHEMA.md](./EVENT-SCHEMA.md)).

---

## SSS Program Addresses (Devnet)

| Program          | Address                                        |
|------------------|------------------------------------------------|
| `sss-token`      | `2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

---

## Webhook Registration

### POST /api/webhooks/register

Register a URL to receive SSS event notifications.

**Request:**
```json
{
  "url": "https://your-indexer.example.com/sss-hook",
  "events": ["MintExecuted", "BurnExecuted", "CDPLiquidated"],
  "secret_key": "your-hmac-secret"
}
```

- `events`: array of event type names, or `["*"]` for all events.
- `secret_key`: optional. If provided, each delivery is signed with `X-SSS-Signature`.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "url": "https://...",
    "events": ["MintExecuted"],
    "created_at": "2026-03-23T18:00:00Z"
  }
}
```

### GET /api/webhooks
List all registered webhooks.

### DELETE /api/webhooks/:id
Remove a webhook by id.

---

## Helius Setup

Helius can watch program addresses and forward raw transaction data. Add the SSS
program addresses to your Helius webhook config, then pipe raw logs through the
SSS indexer schema parser.

```json
{
  "webhookURL": "https://your-backend.example.com/api/webhooks/helius",
  "transactionTypes": ["TRANSFER"],
  "accountAddresses": [
    "2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY"
  ],
  "webhookType": "enhanced"
}
```

When Helius delivers a transaction, extract `meta.logMessages` and pass each
line through the SSS `parse_log_line` parser (or the `/api/events` endpoint).

---

## Shyft Setup

Shyft supports program-level event subscriptions. Configure a callback URL in
your Shyft dashboard for `2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY`.

Shyft delivers `log_messages` arrays; iterate them with `parse_log_line`.

---

## Custom Indexer

Use `getSignaturesForAddress` polling or a WebSocket subscription:

```ts
import { Connection, PublicKey } from '@solana/web3.js';

const SSS_PROGRAM = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const conn = new Connection('https://api.devnet.solana.com');

// Poll for new signatures
const sigs = await conn.getSignaturesForAddress(SSS_PROGRAM, { limit: 50 });
for (const { signature } of sigs) {
  const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
  for (const line of tx?.meta?.logMessages ?? []) {
    // POST to your SSS backend's /api/webhooks/register for forwarding,
    // or parse locally using the SSS Event Schema v1 discriminator table.
    if (line.startsWith('Program log: ') && isKnownSssEvent(line)) {
      // handle event
    }
  }
}
```

---

## Verifying Webhook Signatures

```js
const crypto = require('crypto');

function verifySssSignature(rawBody, secret, header) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return expected === header;
}

// Express example
app.post('/sss-hook', express.raw({ type: '*/*' }), (req, res) => {
  const valid = verifySssSignature(
    req.body,
    process.env.SSS_WEBHOOK_SECRET,
    req.headers['x-sss-signature']
  );
  if (!valid) return res.status(401).send('Signature mismatch');
  const event = JSON.parse(req.body);
  console.log(event.event_type, event.data);
  res.sendStatus(200);
});
```

---

## Webhook Reliability — Retry & Dead Letter Queue (SSS-145)

SSS-145 introduced durable webhook delivery: every outbound call is logged and
retried automatically on failure.

### How It Works

| Attempt | Delay before retry | Status after failure |
|--------:|-------------------|----------------------|
| 1       | 1 s               | `failed`             |
| 2       | 5 s               | `failed`             |
| 3       | —                 | `permanently_failed` + `MetricsAlert` emitted |

A background worker runs every **60 seconds** and re-drives any `failed`
delivery whose `next_retry_at` has passed.

### Delivery Log Schema

Each delivery attempt is recorded in `webhook_delivery_log`:

| Field             | Type    | Description                                        |
|-------------------|---------|----------------------------------------------------|
| `id`              | UUID    | Unique delivery id                                 |
| `webhook_id`      | UUID    | References the registered webhook                  |
| `event_type`      | string  | SSS event type (e.g. `MintExecuted`)               |
| `payload`         | string  | Raw JSON payload sent in the POST body             |
| `status`          | string  | `pending` / `failed` / `delivered` / `permanently_failed` |
| `attempt_count`   | integer | Number of attempts made so far                     |
| `last_attempt_at` | ISO-8601| Timestamp of the most recent attempt               |
| `next_retry_at`   | ISO-8601| When the retry worker will try again (null if done)|
| `created_at`      | ISO-8601| When the delivery was first scheduled              |

### Inspecting Failed Deliveries

```http
GET /api/webhook-deliveries?status=failed
Authorization: Bearer <operator-token>
```

Returns all `permanently_failed` rows so operators can triage undelivered events:

```json
{
  "success": true,
  "data": [
    {
      "id": "d1a2b3c4-...",
      "webhook_id": "a0b1c2d3-...",
      "event_type": "CDPLiquidated",
      "status": "permanently_failed",
      "attempt_count": 3,
      "last_attempt_at": "2026-03-24T01:00:15Z",
      "next_retry_at": null,
      "created_at": "2026-03-24T00:59:55Z"
    }
  ]
}
```

> **Note:** `?status=failed` currently returns `permanently_failed` rows. Future
> releases may support filtering by `pending` or `delivered`.

### MetricsAlert Events

When a delivery permanently fails, the backend emits a `MetricsAlert` event to
`event_log` with `reason: "max_retries_exceeded"`. Wire your alerting pipeline
to this event type to receive real-time pager notifications.

### Recommendations for Subscribers

- **Respond quickly:** Return HTTP 200 within 5 s to avoid retries on slow handlers.
- **Idempotency:** Use the delivery `id` to deduplicate re-delivered events in case
  your endpoint is called more than once.
- **Dead-letter handling:** Poll `GET /api/webhook-deliveries?status=failed` after
  incidents and replay events manually if needed.

---

## Event Schema Reference

See [EVENT-SCHEMA.md](./EVENT-SCHEMA.md) for the full list of event types,
discriminators, and field definitions.
