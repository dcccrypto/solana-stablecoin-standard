# Operations Runbook

Day-to-day operator guide for managing an SSS stablecoin. All examples use the CLI (`solana-stable`). The SDK equivalents are documented in [SDK.md](SDK.md).

## Prerequisites

```bash
cd cli && npm install && npm run build
```

Ensure your `sss-token.config.toml` has the correct authority keypair paths and a deployed mint address.

## Global Flags

All commands accept the following flags:

| Flag | Description |
|------|-------------|
| `--config <path>` | Config file path (default: `sss-token.config.toml`) |
| `--output text\|json` | Output format (`text` is default, `json` for scripting) |
| `--dry-run` | Build and display the transaction without sending |
| `--yes` | Skip confirmation prompts |

## CLI Command Groups

The CLI organizes commands into logical groups:

| Group | Purpose | Example |
|-------|---------|---------|
| `operate` | Day-to-day operations | `solana-stable operate mint ...` |
| `admin` | Admin operations | `solana-stable admin freeze ...` |
| `compliance` | Compliance management | `solana-stable compliance add ...` |
| `inspect` | Read-only queries | `solana-stable inspect status` |

Flat commands (without the group prefix) remain functional for backward compatibility. For example, `solana-stable mint ...` is equivalent to `solana-stable operate mint ...`.

---

## Deployment

### SSS-1 (Minimal)

```bash
# Generate a config
npx solana-stable init --preset sss-1

# Edit sss-token.config.toml:
#   [stablecoin] name, symbol, decimals
#   [authorities] mint, freeze, metadata — set keypair file paths

# Deploy
npx solana-stable init --custom sss-token.config.toml
```

The CLI will:
1. Create a new Token-2022 mint with the Metadata Pointer extension.
2. Initialize on-mint metadata (name, symbol, URI).
3. Write the deployed mint address back into your config file.

### SSS-2 (Compliant)

```bash
npx solana-stable init --preset sss-2

# Edit sss-token.config.toml:
#   Same as SSS-1, plus:
#   [authorities] blacklist = "path/to/admin-keypair.json"
#   [extensions.transferHook] enabled = true
#   [extensions.transferHook] programId = "<deployed-hook-program-id>"

npx solana-stable init --custom sss-token.config.toml
```

The CLI will additionally:
1. Add the Transfer Hook extension pointing to the blacklist program.
2. Initialize the blacklist hook's Config PDA and ExtraAccountMetaList PDA.

---

## Supply Management

### Mint Tokens

```bash
npx solana-stable operate mint <recipient-wallet> <amount-raw-units>
# or (flat, backward-compatible):
npx solana-stable mint <recipient-wallet> <amount-raw-units>
```

**Zero-amount guard**: Mint, burn, burn_from, and seize all reject `amount == 0` with error `ZeroAmount` (6017).

Example: mint 1,000 tokens (with 6 decimals = 1,000,000,000 raw units):

```bash
npx solana-stable operate mint Dkvvhfumm9TZ7oCX9DnowbEaorLvmFpF3T8GZCAaebAT 1000000000
```

The ATA for the recipient is created automatically if it doesn't exist.

### Burn Tokens

```bash
npx solana-stable operate burn <amount-raw-units>
```

Burns from the mint authority's own ATA. `amount` must be greater than 0 (zero-amount guard).

### Transfer Tokens

```bash
npx solana-stable operate transfer <recipient-wallet> <amount-raw-units>
```

Transfers tokens to a recipient wallet. Uses `TransferChecked` with automatic transfer-hook resolution — works for both SSS-1 and SSS-2 tokens. On SSS-2, the blacklist hook is invoked automatically and the transfer is rejected if sender or recipient is blacklisted.

Example:

```bash
npx solana-stable operate transfer Dkvvhfumm9TZ7oCX9DnowbEaorLvmFpF3T8GZCAaebAT 500000000
```

### Check Supply

```bash
npx solana-stable inspect supply
```

### Check Balance

```bash
npx solana-stable inspect balance <wallet>
```

---

## Account Management

### Freeze an Account

Prevents the account from sending or receiving tokens.

```bash
npx solana-stable admin freeze <token-account-address>
```

Note: this takes the **token account** (ATA) address, not the wallet address.

### Thaw an Account

```bash
npx solana-stable admin thaw <token-account-address>
```

### Pause / Unpause (Pausable Extension)

Halts all transfers for the entire mint. Requires the Pausable extension.

```bash
npx solana-stable admin pause
npx solana-stable admin unpause
```

> **Triple pause**: Token-2022 `PausableConfig` is a protocol-level halt (blocks everything). SSS-Core `config.paused` is an application-level halt (blocks only program-gated ops like mint/burn/seize). The blacklist hook's `pause_hook` / `unpause_hook` is a transfer-level halt (blocks all transfers through the hook while mints/burns still work). See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

---

## Authority Management

### View Current Authorities

```bash
npx solana-stable inspect status
```

Shows the on-chain mint authority, freeze authority, and other config info.

### Transfer an Authority

```bash
npx solana-stable admin set-authority <type> <new-public-key>
```

Supported types: `mint`, `freeze`, `metadata`, `metadata-pointer`, `pause`, `permanent-delegate`, `close-mint`, `interest-rate`.

Example — transfer freeze authority:

```bash
npx solana-stable admin set-authority freeze GFL8QJXA1eox5ZiqsjL1P19NB8svWRL6nHDzPFetTjVh
```

### Revoke an Authority

Pass `none` as the new authority:

```bash
npx solana-stable admin set-authority mint none
```

**Warning**: Revoking the mint authority is irreversible. No more tokens can ever be minted.

---

## Compliance Operations (SSS-2)

These commands require an SSS-2 token with a configured blacklist program.

### Blacklist a Wallet

```bash
npx solana-stable compliance add <wallet> --reason "OFAC SDN"
```

The wallet will be unable to send or receive this token. The on-chain `BlacklistEntry` PDA is created (if it doesn't exist) with `blocked = true`. The `--reason` parameter (max 128 chars) is stored on-chain in the PDA for audit compliance.

### Remove from Blacklist

```bash
npx solana-stable compliance remove <wallet>
```

Sets `blocked = false` on the PDA. The PDA remains on-chain for future use.

### Check Blacklist Status

```bash
npx solana-stable compliance check <wallet>
```

Read-only — reports whether the wallet is currently blocked.

### Close a Blacklist Entry (Reclaim Rent)

```bash
npx solana-stable compliance close <wallet>
```

Closes an unblocked (`blocked = false`) BlacklistEntry PDA and reclaims rent to the admin. Fails if the entry is still blocked.

### Transfer Blacklist Admin (Two-Step)

```bash
# Step 1: Current admin nominates the new admin
npx solana-stable compliance transfer-admin <new-admin-pubkey>

# Step 2: New admin accepts the role
npx solana-stable compliance accept-admin <keypair-path>
```

The current admin remains active until the new admin accepts.

### Toggle Compliance Enforcement

Enable or disable compliance (blacklist checks on mint) via the SDK:

```typescript
await stable.core.setCompliance(authorityKeypair, true);  // enable
await stable.core.setCompliance(authorityKeypair, false); // disable
```

When `compliance_enabled` is true, `mint_tokens` checks the recipient's blacklist entry before minting. This flag is stored on the `StablecoinConfig` PDA and can be toggled at any time by the authority.

### Update On-Mint Metadata (SDK)

Update the token's name, symbol, or URI via the authority:

```typescript
await stable.core.updateMetadata(authorityKeypair, "name", "Updated Token Name");
await stable.core.updateMetadata(authorityKeypair, "uri", "https://example.com/new-metadata.json");
```

### Reserve Attestation (Proof-of-Reserve)

Issuers can record proof-of-reserve attestations on-chain to support regulatory transparency (e.g., GENIUS Act compliance). An attestor with `ROLE_ATTESTOR` calls `attest_reserve` with:

- **reserve_amount** — Total reserve backing (raw units)
- **source** — Short description of the reserve source (max 128 chars, e.g. "US Treasury Bills")
- **uri** — Link to off-chain proof document (max 256 chars, e.g. auditor report URL)

The `ReserveAttestation` PDA is created or updated (one per config). Anyone can read the latest attestation via `view_reserve` (simulate call). See [COMPLIANCE.md](COMPLIANCE.md) for regulatory context.

**CLI/SDK:** On-chain support is available; CLI and SDK convenience methods may be added in a future release. For now, use the program IDL directly or build transactions manually.

### Burn From Any Account (SDK)

Burn tokens from any holder's account using the permanent delegate. Unlike `burn_tokens` (which only burns from the burner's own ATA), `burn_from` can target any account:

```typescript
await stable.core.burnFrom(burnerKeypair, targetAta, 100_000n);
```

Requires `ROLE_BURNER`.

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

This thaws the account, burns the specified amount (via permanent delegate), mints the same amount to the treasury, and re-freezes the account. `amount` must be greater than 0 (zero-amount guard).

---

## Audit & Monitoring

### Transaction History

```bash
npx solana-stable inspect audit-log --limit 50
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
npx solana-stable admin freeze <compromised-ata>
```

### Blacklist a Sanctioned Wallet (SSS-2)

```bash
npx solana-stable compliance add <wallet> --reason "sanctions match"
```

This takes effect immediately — the next transfer attempt will be rejected by the transfer hook.

### Pause All Transfers

If the Pausable extension is enabled:

```bash
npx solana-stable admin pause
```

To resume:

```bash
npx solana-stable admin unpause
```

### Revoke Mint Authority (Kill Switch)

```bash
npx solana-stable admin set-authority mint none
```

No new tokens can be created after this. Existing tokens continue to function normally.
