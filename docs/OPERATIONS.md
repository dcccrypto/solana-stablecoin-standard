# Operations Runbook

Day-to-day operator guide for managing an SSS stablecoin. All examples use the CLI (`sss-token`). The SDK equivalents are documented in [SDK.md](SDK.md).

## Prerequisites

```bash
cd cli && npm install && npm run build
```

Ensure your `sss-token.config.toml` has the correct authority keypair paths and a deployed mint address.

---

## Deployment

### SSS-1 (Minimal)

```bash
# Generate a config
npx sss-token init --preset sss-1

# Edit sss-token.config.toml:
#   [stablecoin] name, symbol, decimals
#   [authorities] mint, freeze, metadata — set keypair file paths

# Deploy
npx sss-token init --custom sss-token.config.toml
```

The CLI will:
1. Create a new Token-2022 mint with the Metadata Pointer extension.
2. Initialize on-mint metadata (name, symbol, URI).
3. Write the deployed mint address back into your config file.

### SSS-2 (Compliant)

```bash
npx sss-token init --preset sss-2

# Edit sss-token.config.toml:
#   Same as SSS-1, plus:
#   [authorities] blacklist = "path/to/admin-keypair.json"
#   [extensions.transferHook] enabled = true
#   [extensions.transferHook] programId = "<deployed-hook-program-id>"

npx sss-token init --custom sss-token.config.toml
```

The CLI will additionally:
1. Add the Transfer Hook extension pointing to the blacklist program.
2. Initialize the blacklist hook's Config PDA and ExtraAccountMetaList PDA.

---

## Supply Management

### Mint Tokens

```bash
npx sss-token mint <recipient-wallet> <amount-raw-units>
```

Example: mint 1,000 tokens (with 6 decimals = 1,000,000,000 raw units):

```bash
npx sss-token mint Dkvvhfumm9TZ7oCX9DnowbEaorLvmFpF3T8GZCAaebAT 1000000000
```

The ATA for the recipient is created automatically if it doesn't exist.

### Burn Tokens

```bash
npx sss-token burn <amount-raw-units>
```

Burns from the mint authority's own ATA.

### Check Supply

```bash
npx sss-token supply
```

### Check Balance

```bash
npx sss-token balance <wallet>
```

---

## Account Management

### Freeze an Account

Prevents the account from sending or receiving tokens.

```bash
npx sss-token freeze <token-account-address>
```

Note: this takes the **token account** (ATA) address, not the wallet address.

### Thaw an Account

```bash
npx sss-token thaw <token-account-address>
```

### Pause / Unpause (Pausable Extension)

Halts all transfers for the entire mint. Requires the Pausable extension.

```bash
npx sss-token pause
npx sss-token unpause
```

---

## Authority Management

### View Current Authorities

```bash
npx sss-token status
```

Shows the on-chain mint authority, freeze authority, and other config info.

### Transfer an Authority

```bash
npx sss-token set-authority <type> <new-public-key>
```

Supported types: `mint`, `freeze`, `metadata`, `metadata-pointer`, `pause`, `permanent-delegate`, `close-mint`, `interest-rate`.

Example — transfer freeze authority:

```bash
npx sss-token set-authority freeze GFL8QJXA1eox5ZiqsjL1P19NB8svWRL6nHDzPFetTjVh
```

### Revoke an Authority

Pass `none` as the new authority:

```bash
npx sss-token set-authority mint none
```

**Warning**: Revoking the mint authority is irreversible. No more tokens can ever be minted.

---

## Compliance Operations (SSS-2)

These commands require an SSS-2 token with a configured blacklist program.

### Blacklist a Wallet

```bash
npx sss-token blacklist add <wallet>
```

The wallet will be unable to send or receive this token. The on-chain `BlacklistEntry` PDA is created (if it doesn't exist) with `blocked = true`.

### Remove from Blacklist

```bash
npx sss-token blacklist remove <wallet>
```

Sets `blocked = false` on the PDA. The PDA remains on-chain for future use.

### Check Blacklist Status

```bash
npx sss-token blacklist check <wallet>
```

Read-only — reports whether the wallet is currently blocked.

### Close a Blacklist Entry (Reclaim Rent)

```bash
npx sss-token blacklist close <wallet>
```

Closes an unblocked (`blocked = false`) BlacklistEntry PDA and reclaims rent to the admin. Fails if the entry is still blocked.

### Transfer Blacklist Admin (Two-Step)

```bash
# Step 1: Current admin nominates the new admin
npx sss-token blacklist transfer-admin <new-admin-pubkey>

# Step 2: New admin accepts the role
npx sss-token blacklist accept-admin <keypair-path>
```

The current admin remains active until the new admin accepts.

### Seize Tokens (SDK Only)

Seize tokens from a frozen account using the burn+mint pattern (requires permanent delegate):

```typescript
await stable.seize({
  targetTokenAccount: frozenAta,
  treasury: treasuryWallet,
  amount: 1_000_000n,
  authority: adminKeypair,
});
```

This thaws the account, burns the specified amount (via permanent delegate), mints the same amount to the treasury, and re-freezes the account.

---

## Audit & Monitoring

### Transaction History

```bash
npx sss-token audit-log --limit 50
```

Fetches recent transaction signatures involving the mint from the chain.

### Continuous Monitoring (Backend)

For real-time monitoring, run the backend service:

```bash
cd backend && npm run dev
```

Register a webhook to receive POST notifications:

```bash
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com/hook", "events": ["*"]}'
```

---

## Emergency Procedures

### Freeze a Compromised Account

```bash
npx sss-token freeze <compromised-ata>
```

### Blacklist a Sanctioned Wallet (SSS-2)

```bash
npx sss-token blacklist add <wallet>
```

This takes effect immediately — the next transfer attempt will be rejected by the transfer hook.

### Pause All Transfers

If the Pausable extension is enabled:

```bash
npx sss-token pause
```

To resume:

```bash
npx sss-token unpause
```

### Revoke Mint Authority (Kill Switch)

```bash
npx sss-token set-authority mint none
```

No new tokens can be created after this. Existing tokens continue to function normally.
