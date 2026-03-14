# SSS — Quickstart Guide

> End-to-end walkthrough: deploy a stablecoin, mint tokens, enforce compliance, and query events.
> Covers SSS-1 (minimal) and SSS-2 (compliant with on-chain blacklist).

---

## Prerequisites

```bash
# Solana CLI / Agave 2.3.x
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.13/install)"

# Anchor CLI 0.32
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.0 && avm use 0.32.0

# Node.js 18+
node --version

# Clone the repo and install deps
git clone https://github.com/dcccrypto/solana-stablecoin-standard
cd solana-stablecoin-standard
npm install
cd sdk && npm install && cd ..
```

---

## Part 1 — SSS-1 Minimal Stablecoin (localnet)

### 1. Start a local validator

```bash
solana-test-validator --reset
```

### 2. Build and deploy

```bash
anchor build
anchor deploy
```

This deploys both `sss-token` and `sss-transfer-hook` to localnet.

### 3. Create a wallet and fund it

```bash
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase
solana config set --url localhost
solana airdrop 5
```

### 4. Create an SSS-1 stablecoin

```typescript
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import { SolanaStablecoin, sss1Config } from '@stbr/sss-token';
import fs from 'fs';

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8')))
);
const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const provider = new AnchorProvider(connection, new Wallet(keypair), {});

const stablecoin = await SolanaStablecoin.create(provider, sss1Config({
  name: 'My Stablecoin',
  symbol: 'MUSD',
  decimals: 6,
}));

console.log('Mint address:', stablecoin.mint.toBase58());
```

`SolanaStablecoin.create()` submits one `initialize` transaction and returns a ready-to-use instance. The mint keypair is generated internally; the caller's wallet becomes the overall authority and compliance authority.

### 5. Mint tokens

```typescript
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// Create recipient ATA
const ata = await getOrCreateAssociatedTokenAccount(
  connection,
  keypair,
  stablecoin.mint,
  keypair.publicKey,
  false,
  'confirmed',
  {},
  TOKEN_2022_PROGRAM_ID
);

// Mint 1,000 MUSD (1,000 × 10^6 base units)
const sig = await stablecoin.mintTo({
  recipient: ata.address,
  amount: 1_000_000_000n,
});
console.log('Mint tx:', sig);
```

### 6. Check supply

```typescript
const supply = await stablecoin.getTotalSupply();
console.log('Circulating:', supply.circulatingSupply.toString());
// → 1000000000
```

### 7. Burn tokens

```typescript
const burnSig = await stablecoin.burnFrom({
  source: ata.address,
  amount: 500_000_000n,   // burn 500 MUSD
});
console.log('Burn tx:', burnSig);
```

### 8. Pause and unpause minting

```typescript
await stablecoin.pause();     // no minting or burning while paused
await stablecoin.unpause();   // resume
```

---

## Part 2 — SSS-2 Compliant Stablecoin (on-chain blacklist)

SSS-2 adds a transfer hook program. Every Token-2022 transfer is checked against a `BlacklistState` PDA on-chain — no off-chain middleware can bypass it.

### 1. Create an SSS-2 stablecoin

```typescript
import { SolanaStablecoin, sss2Config, SSS_TRANSFER_HOOK_PROGRAM_ID } from '@stbr/sss-token';

const stablecoin = await SolanaStablecoin.create(provider, sss2Config({
  name: 'Compliant USD',
  symbol: 'CUSD',
  decimals: 6,
  transferHookProgram: SSS_TRANSFER_HOOK_PROGRAM_ID,
}));

console.log('SSS-2 mint:', stablecoin.mint.toBase58());
```

SSS-2 initialization registers the transfer hook, creates the `BlacklistState` PDA, and sets the permanent delegate — all in one transaction.

### 2. Freeze a token account

```typescript
await stablecoin.freeze({ account: suspectAta });

// All minting to and burning from suspectAta is now rejected
// until thawed:
await stablecoin.thaw({ account: suspectAta });
```

### 3. Manage the compliance module

Use `ComplianceModule` to manage the on-chain blacklist:

```typescript
import { ComplianceModule } from '@stbr/sss-token';

const compliance = new ComplianceModule(provider, stablecoin.mint);

// Add a wallet to the transfer-hook blacklist
await compliance.addToBlacklist({ address: suspectWallet });

// Any transfer from or to suspectWallet now fails on-chain
// with TransactionError: transfer hook returned an error

// Remove from blacklist
await compliance.removeFromBlacklist({ address: suspectWallet });
```

The blacklist is enforced by the `sss-transfer-hook` program at the Token-2022 level. It is checked synchronously before every transfer instruction completes.

---

## Part 3 — REST Backend

The `sss-backend` server provides a REST API for recording mint/burn events, querying compliance audit logs, and managing webhooks. It is complementary to the on-chain SDK — not a replacement.

### 1. Start the backend

```bash
cd backend

# Default: in-memory SQLite, port 3000
cargo run --release
```

Or with Docker:

```bash
docker compose up
```

### 2. Create an API key

```bash
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -d '{"label": "dev-key"}'
# → {"key": "sss_abc123...", "id": "...", "label": "dev-key", ...}
```

All subsequent requests require `Authorization: Bearer <key>`.

### 3. Record a mint event

```typescript
import { SSSClient } from '@stbr/sss-token';

const client = new SSSClient('http://localhost:3000', 'sss_abc123...');

// After a successful on-chain mintTo(), record it in the backend
const event = await client.mint({
  token_mint: stablecoin.mint.toBase58(),
  amount: 1_000_000_000,
  recipient: ata.address.toBase58(),
  tx_signature: mintSig,
});
console.log('Event ID:', event.id);
```

### 4. Query events

```typescript
const { mint_events, burn_events } = await client.getEvents(
  stablecoin.mint.toBase58(),
  50   // limit
);
console.log('Mint events:', mint_events.length);
```

### 5. Audit log

```typescript
// All events
const log = await client.getAuditLog();

// Filter by action
const blacklistActions = await client.getAuditLog({
  action: 'BLACKLIST_ADD',
  limit: 100,
});
```

### 6. Webhooks

```typescript
// Register a webhook for all mint and burn events
const hook = await client.addWebhook({
  url: 'https://your-service.example.com/sss-webhook',
  events: ['mint', 'burn'],
});
console.log('Webhook ID:', hook.id);

// List active webhooks
const hooks = await client.getWebhooks();

// Remove
await client.deleteWebhook(hook.id);
```

The backend sends a signed `POST` to your URL within ~1 second of the event being recorded. See [api.md](./api.md) for the full webhook payload schema.

---

## Part 4 — Two-Step Authority Transfer

Changing the overall authority requires a two-step handshake to prevent accidental transfers to unreachable addresses.

```typescript
// Step 1: current authority proposes a new authority
await stablecoin.proposeAuthority({
  newAuthority: newOwner.publicKey,
});

// Step 2: new authority accepts (must sign with newOwner wallet)
const newProvider = new AnchorProvider(connection, new Wallet(newOwner), {});
const stablecoinAsNew = await SolanaStablecoin.load(newProvider, stablecoin.mint, config);
await stablecoinAsNew.acceptAuthority();

// Compliance authority transfer follows the same pattern
await stablecoin.proposeAuthority({ newAuthority: newCompliance.publicKey, role: 'compliance' });
await stablecoinAsNewCompliance.acceptComplianceAuthority();
```

If the new authority never accepts, the proposal can be overwritten by proposing again.

---

## Part 5 — Devnet Deployment

```bash
# Switch to devnet
solana config set --url devnet
solana airdrop 2

# Deploy (requires a funded wallet with ~2 SOL for rent)
bash scripts/deploy-devnet.sh

# Verify deployment with smoke test
npx ts-node scripts/smoke-test-devnet.ts
```

Deployed program IDs are recorded in `Anchor.toml` and `docs/devnet-deploy.md`.

---

## Next Steps

| Topic | Doc |
|-------|-----|
| Full on-chain SDK reference | [on-chain-sdk-core.md](./on-chain-sdk-core.md) |
| Authority & collateral methods | [on-chain-sdk-authority-collateral.md](./on-chain-sdk-authority-collateral.md) |
| Admin & governance methods | [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) |
| REST API endpoints | [api.md](./api.md) |
| Compliance audit log | [compliance-audit-log.md](./compliance-audit-log.md) |
| Transfer hook internals | [transfer-hook.md](./transfer-hook.md) |
| Anchor program tests | [anchor-program-testing.md](./anchor-program-testing.md) |
| Formal verification (Kani) | [formal-verification.md](./formal-verification.md) |
| Devnet deployment guide | [devnet-deploy.md](./devnet-deploy.md) |
| Rate limiting | [rate-limiting.md](./rate-limiting.md) |
| SSS preset specs | [SSS-1.md](./SSS-1.md) · [SSS-2.md](./SSS-2.md) · [SSS-3.md](./SSS-3.md) |
