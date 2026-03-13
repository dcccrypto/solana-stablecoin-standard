# SSS — TypeScript SDK & CLI

> **Feature:** SSS-005  
> **Packages:** `@stbr/sss-token` (SDK) · `sss-token` (CLI)

---

## Overview

The TypeScript SDK (`@stbr/sss-token`) provides a typed `SSSClient` class that wraps every SSS backend endpoint. The CLI (`sss-token`) is a thin Commander.js shell around the same client, suitable for scripting, local development, and quick ad-hoc operations.

Both packages live in the same monorepo and share types from `sdk/src/types.ts`.

---

## Installation

### SDK

```bash
npm install @stbr/sss-token
```

### CLI (global)

```bash
npm install -g @stbr/sss-token
```

Or run without installing:

```bash
npx sss-token --help
```

---

## SDK Usage

### Importing

```typescript
import { SSSClient, SSSError } from "@stbr/sss-token";
```

### Creating a client

```typescript
const client = new SSSClient(
  "https://your-sss-backend.example.com", // trailing slash is stripped automatically
  "sss_yourApiKeyHere"
);
```

### Error handling

Every method throws `SSSError` on failure. `SSSError` extends `Error` and exposes:

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error from the backend |
| `statusCode` | `number \| undefined` | HTTP status code, when available |

```typescript
try {
  const supply = await client.getSupply("So111...");
} catch (err) {
  if (err instanceof SSSError) {
    console.error(`Backend error (${err.statusCode}): ${err.message}`);
  }
}
```

---

## SDK Reference

### Health

```typescript
// No API key required
const health = await client.health();
// → { status: "ok", version: "0.1.0", timestamp: "2026-03-13T19:54:00Z" }
```

### Mint

Record a stablecoin mint event.

```typescript
const event = await client.mint({
  token_mint: "So11111111111111111111111111111111111111112",
  amount: 1_000_000,          // raw token units
  recipient: "RecipientPubkey...",
  tx_signature: "5KtP9x...",  // optional
});
// → MintEvent { id, token_mint, amount, recipient, tx_signature, created_at }
```

### Burn

Record a stablecoin burn event.

```typescript
const event = await client.burn({
  token_mint: "So11111111111111111111111111111111111111112",
  amount: 500_000,
  source: "SourcePubkey...",
  tx_signature: "3Yz8Ab...", // optional
});
// → BurnEvent { id, token_mint, amount, source, tx_signature, created_at }
```

### Supply

Query circulating supply.

```typescript
// All mints
const all = await client.getSupply();

// Specific mint
const data = await client.getSupply("So111...");
// → { token_mint, total_minted, total_burned, circulating_supply }
```

### Events

List mint/burn events.

```typescript
// All events, optionally filtered
const data = await client.getEvents("So111...", 50);
// → { mint_events: MintEvent[], burn_events: BurnEvent[] }
```

Both parameters are optional. `tokenMint` filters by mint address; `limit` caps the number of results returned.

### Compliance — Blacklist

```typescript
// List
const list = await client.getBlacklist();
// → BlacklistEntry[]

// Add
const entry = await client.addToBlacklist({
  address: "SuspectWallet...",
  reason: "Known fraud",
});
// → BlacklistEntry { id, address, reason, created_at }

// Remove
const result = await client.removeFromBlacklist(entry.id);
// → { removed: true, id: "..." }
```

### Compliance — Audit Log

```typescript
const log = await client.getAuditLog();
// → AuditEntry[] { id, action, address, details, created_at }
```

### Webhooks

```typescript
// List
const hooks = await client.getWebhooks();
// → WebhookEntry[]

// Register
const hook = await client.addWebhook({
  url: "https://your-server.com/webhook",
  events: ["mint", "burn"],  // or ["all"]
});
// → WebhookEntry { id, url, events, created_at }

// Delete
const result = await client.deleteWebhook(hook.id);
// → { deleted: true, id: "..." }
```

### API Key Management

```typescript
// List (key values are redacted; only prefix shown)
const keys = await client.listApiKeys();
// → ApiKeyListEntry[] { id, label, key_prefix, created_at }

// Create (full key returned only at creation time — store it securely)
const newKey = await client.createApiKey("my-service");
// → ApiKeyEntry { id, key, label, created_at }

// Delete
const result = await client.deleteApiKey(newKey.id);
// → { deleted: true }
```

---

## CLI Usage

Global options apply to every subcommand:

```
Options:
  -u, --url <url>      Backend base URL  [default: http://localhost:8080]
  -k, --key <apiKey>   API key (or set SSS_API_KEY env var)
```

Setting `SSS_API_KEY` in your environment is recommended to avoid passing `--key` on every call.

```bash
export SSS_API_KEY=sss_yourApiKeyHere
```

---

## CLI Command Reference

### `health`

```bash
sss-token health
# No API key required
```

### `mint`

```bash
sss-token mint \
  --token-mint So11111111111111111111111111111111111111112 \
  --amount 1000000 \
  --recipient RecipientPubkey... \
  --tx-sig 5KtP9x...          # optional
```

### `burn`

```bash
sss-token burn \
  --token-mint So11111111111111111111111111111111111111112 \
  --amount 500000 \
  --source SourcePubkey... \
  --tx-sig 3Yz8Ab...          # optional
```

### `supply`

```bash
sss-token supply                              # all mints
sss-token supply --token-mint So111...        # specific mint
```

### `events`

```bash
sss-token events
sss-token events --token-mint So111... --limit 20
```

### `blacklist`

```bash
sss-token blacklist list
sss-token blacklist add --address WalletPubkey... --reason "Known fraud"
sss-token blacklist remove --id <entry-id>
```

### `audit`

```bash
sss-token audit
```

### `webhook`

```bash
sss-token webhook list
sss-token webhook add --url https://your-server.com/hook --events mint,burn
sss-token webhook delete --id <webhook-id>
```

`--events` accepts a comma-separated list of `mint`, `burn`, or `all`.

### `key`

```bash
sss-token key list
sss-token key create --label "ci-pipeline"
sss-token key delete --id <key-id>
```

---

## Output Format

All CLI commands print a JSON response to stdout. Errors print to stderr and exit with code 1:

```
Error (429): Rate limit exceeded
```

This makes the CLI pipe-friendly:

```bash
sss-token supply --token-mint So111... | jq '.circulating_supply'
```

---

## Implementation Notes

- The SDK `package.json` exports `@stbr/sss-token` with separate `types` and `main`/`module` fields.
- The CLI is the `bin` entry of the same package; importing `@stbr/sss-token` in a Node script gives the SDK, while `sss-token` on the command line gives the CLI.
- All requests set `Content-Type: application/json` and `X-Api-Key` headers automatically. The health endpoint is the only call that skips the `X-Api-Key` header.
- `SSSError` uses `Object.setPrototypeOf` to preserve `instanceof` correctness across TypeScript transpilation targets.

---

## Testing

```bash
cd sdk
npm test
```

Tests use [Vitest](https://vitest.dev/) and are located in `sdk/tests/client.test.ts`.
