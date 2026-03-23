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
| `sss-token`      | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
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
    "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"
  ],
  "webhookType": "enhanced"
}
```

When Helius delivers a transaction, extract `meta.logMessages` and pass each
line through the SSS `parse_log_line` parser (or the `/api/events` endpoint).

---

## Shyft Setup

Shyft supports program-level event subscriptions. Configure a callback URL in
your Shyft dashboard for `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`.

Shyft delivers `log_messages` arrays; iterate them with `parse_log_line`.

---

## Custom Indexer

Use `getSignaturesForAddress` polling or a WebSocket subscription:

```ts
import { Connection, PublicKey } from '@solana/web3.js';

const SSS_PROGRAM = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
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

## Event Schema Reference

See [EVENT-SCHEMA.md](./EVENT-SCHEMA.md) for the full list of event types,
discriminators, and field definitions.
