# Migration Guide

Move from raw SPL Token / Token-2022 to the Solana Stablecoin Standard SDK — or upgrade between SSS presets.

---

## Table of Contents

1. [From SPL Token (Classic) to SSS-1](#1-from-spl-token-classic-to-sss-1)
2. [From Raw Token-2022 to SSS-1](#2-from-raw-token-2022-to-sss-1)
3. [From SSS-1 to SSS-2 (adding compliance)](#3-from-sss-1-to-sss-2-adding-compliance)
4. [From SSS-2 to SSS-3 (adding collateral)](#4-from-sss-2-to-sss-3-adding-collateral)
5. [Backend: from bare axum to SSS REST API](#5-backend-from-bare-axum-to-sss-rest-api)
6. [Common Pitfalls](#6-common-pitfalls)

---

## 1. From SPL Token (Classic) to SSS-1

### Before (raw SPL Token)

```ts
import {
  createMint,
  mintTo,
  createAssociatedTokenAccountIdempotent,
  burn,
  freezeAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, Connection } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');

// 1. Create mint
const mint = await createMint(
  connection,
  payer,          // fee payer
  authority.publicKey,
  authority.publicKey,  // freeze authority
  6               // decimals
);

// 2. Mint tokens
const ata = await createAssociatedTokenAccountIdempotent(
  connection, payer, mint, recipient
);
await mintTo(connection, payer, mint, ata, authority, 1_000_000n);

// 3. Burn tokens
await burn(connection, payer, sourceAta, mint, owner, 500_000n);

// 4. Freeze an account
await freezeAccount(connection, payer, ata, mint, authority);
```

### After (SSS-1)

```ts
import { SolanaStablecoin } from '@stbr/sss-token';
import { AnchorProvider } from '@coral-xyz/anchor';

const provider = new AnchorProvider(connection, wallet, {});

// 1. Create stablecoin (handles mint, metadata, config PDA)
const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-1',
  name: 'My Stablecoin',
  symbol: 'MST',
  decimals: 6,
});

// 2. Mint tokens (creates ATA if needed)
await stablecoin.mintTo({
  mint: stablecoin.mint,
  amount: 1_000_000n,
  recipient: recipientPubkey,
});

// 3. Burn tokens
await stablecoin.burnFrom({
  mint: stablecoin.mint,
  amount: 500_000n,
  source: sourceAta,
});

// 4. Freeze an account
await stablecoin.freeze({
  mint: stablecoin.mint,
  targetTokenAccount: ata,
});
```

### Key differences

| SPL Token (classic) | SSS-1 |
|---------------------|-------|
| `TOKEN_PROGRAM_ID` | `TOKEN_2022_PROGRAM_ID` (automatic) |
| Manual mint creation | `SolanaStablecoin.create()` handles mint + metadata + on-chain config |
| Freeze authority = any keypair | Freeze authority = on-chain `StablecoinConfig` PDA |
| No supply tracking | `getTotalSupply()` returns `circulatingSupply`, `totalMinted`, `totalBurned` |
| No pause support | `pause()` / `unpause()` built in |
| Manual ATA creation | ATA created automatically in `mintTo()` |

### Install

```bash
npm install @stbr/sss-token @coral-xyz/anchor @solana/web3.js @solana/spl-token
```

---

## 2. From Raw Token-2022 to SSS-1

If you're already on Token-2022 but managing extensions manually:

### Before (raw Token-2022)

```ts
import {
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  TYPE_SIZE,
  LENGTH_SIZE,
  getMintLen,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';

// Manual multi-instruction mint setup
const extensions = [ExtensionType.MetadataPointer];
const mintLen = getMintLen(extensions);
const metaData = { name, symbol, uri, additionalMetadata: [] };
const metaDataLen = TYPE_SIZE + LENGTH_SIZE + pack(metaData).length;

const createMintTx = new Transaction().add(
  SystemProgram.createAccount({ lamports, space: mintLen + metaDataLen, ... }),
  createInitializeMetadataPointerInstruction(...),
  createInitializeMintInstruction(...),
  createInitializeInstruction(...),
);
await sendAndConfirmTransaction(connection, createMintTx, [payer, mintKp]);
```

### After (SSS-1)

```ts
const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-1',
  name: 'My Token',
  symbol: 'MTK',
  uri: 'https://mytoken.com/meta.json',
  decimals: 6,
});
// Done — extensions, metadata, config PDA all initialised in one call.
```

SSS-1 sets up: `MetadataPointer`, `TokenMetadata`, freeze authority, and an on-chain `StablecoinConfig` PDA that tracks minting authority, pause state, and per-minter caps.

### Attach to an existing mint

If you deployed a Token-2022 mint before adopting the SSS SDK, you can wrap it for read operations:

```ts
// Attach to existing mint (read-only — config PDA must already exist on-chain)
const stablecoin = new SolanaStablecoin(provider, existingMintPubkey, configPda, config, programId);

// Or fetch info without a full SDK instance
const info = await SolanaStablecoin.getInfo(provider, existingMintPubkey);
```

> **Note:** If the `StablecoinConfig` PDA does not exist on-chain (i.e. the mint was not created through the SSS program), you must initialize a new mint — the on-chain state cannot be back-filled.

---

## 3. From SSS-1 to SSS-2 (adding compliance)

SSS-2 adds three features on top of SSS-1:

| Feature | SSS-1 | SSS-2 |
|---------|:---:|:---:|
| Permanent delegate | ❌ | ✅ |
| Transfer hook | ❌ | ✅ |
| On-chain blacklist | ❌ | ✅ |

You **cannot upgrade an existing SSS-1 mint** to SSS-2 after creation — Token-2022 extensions are set at mint initialization time. You need to create a new SSS-2 mint and migrate holders.

### Create an SSS-2 mint

```ts
import { SolanaStablecoin, ComplianceModule } from '@stbr/sss-token';
import { SSS_TRANSFER_HOOK_PROGRAM_ID } from '@stbr/sss-token';

const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-2',
  name: 'USD Stable',
  symbol: 'USDS',
  decimals: 6,
  transferHookProgram: SSS_TRANSFER_HOOK_PROGRAM_ID,
});

// Initialize the blacklist (required before any transfers)
const compliance = new ComplianceModule(
  provider,
  stablecoin.mint,
  SSS_TRANSFER_HOOK_PROGRAM_ID
);
await compliance.initializeBlacklist();
```

### Migrate holders from SSS-1 → SSS-2

```ts
// 1. Pause the old SSS-1 mint (no new transfers)
await oldStablecoin.pause({ mint: oldStablecoin.mint });

// 2. Snapshot all token accounts
const accounts = await connection.getTokenAccountsByOwner(/* ... */);

// 3. For each holder: burn old tokens, mint equivalent on new mint
for (const { pubkey, account } of accounts) {
  const decoded = unpackAccount(pubkey, account, TOKEN_2022_PROGRAM_ID);
  if (decoded.amount === 0n) continue;

  await oldStablecoin.burnFrom({
    mint: oldStablecoin.mint,
    amount: decoded.amount,
    source: pubkey,
  });
  await newStablecoin.mintTo({
    mint: newStablecoin.mint,
    amount: decoded.amount,
    recipient: decoded.owner,
  });
}
```

### Add compliance operations

```ts
const compliance = new ComplianceModule(
  provider,
  stablecoin.mint,
  SSS_TRANSFER_HOOK_PROGRAM_ID
);

// Block a wallet at the chain level (enforced by transfer hook)
await compliance.addToBlacklist(suspectAddress);

// Check status
const blocked = await compliance.isBlacklisted(walletPubkey);
console.log(blocked); // true | false

// Remove from blacklist
await compliance.removeFromBlacklist(rehabilitatedAddress);

// Account-level freeze (different from blacklist — freezes the token account, not the wallet)
await stablecoin.freeze({ mint: stablecoin.mint, targetTokenAccount: ata });
await stablecoin.thaw({ mint: stablecoin.mint, targetTokenAccount: ata });
```

**Blacklist vs freeze:**
- **Blacklist** — enforced by the transfer hook on every SPL transfer. Blocks a wallet's _address_ across all ATAs.
- **Freeze** — Token-2022 account-level freeze on a specific ATA. The wallet can still use other token accounts.

---

## 4. From SSS-2 to SSS-3 (adding collateral)

SSS-3 adds on-chain collateral enforcement and ZK confidential transfers (reference design).

> **SSS-3 is a reference design.** The on-chain program includes `deposit_collateral` and `redeem` instructions. Confidential transfer ZK proofs are outlined in [SSS-3.md](./SSS-3.md) but are not yet wired end-to-end.

### Create an SSS-3 mint

```ts
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-3',
  name: 'Collateral Stable',
  symbol: 'cUSD',
  decimals: 6,
  transferHookProgram: SSS_TRANSFER_HOOK_PROGRAM_ID,
  collateralMint: usdcMintPubkey,     // e.g. USDC devnet mint
  reserveVault: reserveVaultPubkey,   // pre-created token account
  maxSupply: 1_000_000_000_000n,      // 1M tokens (6 decimals)
});
```

### Deposit collateral

```ts
await stablecoin.depositCollateral({
  amount: 1_000_000n,                   // 1 USDC (6 decimals)
  depositorCollateral: myUsdcAccount,
  reserveVault: reserveVaultPubkey,
  collateralMint: usdcMintPubkey,
});
```

### Redeem collateral

```ts
await stablecoin.redeem({
  amount: 1_000_000n,                   // 1 cUSD to burn
  redeemerSssAccount: mySssTokenAccount,
  collateralMint: usdcMintPubkey,
  reserveVault: reserveVaultPubkey,
  redeemerCollateral: myUsdcAccount,
  collateralTokenProgram: TOKEN_PROGRAM_ID,
});
```

### Max supply enforcement

SSS-3 supports an on-chain `max_supply` cap enforced by the program:

```ts
// Set at creation
const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-3',
  maxSupply: 100_000_000_000n, // 100K tokens
  // ...
});

// Attempting to mint beyond cap throws SSSError
try {
  await stablecoin.mintTo({ amount: 200_000_000_000n, ... });
} catch (err) {
  // Error: SupplyCapExceeded
}
```

---

## 5. Backend: from bare axum to SSS REST API

If you're migrating from a custom axum service, the SSS backend provides a full REST API with auth, rate limiting, webhooks, and an audit log.

### Before (bare axum handler)

```rust
async fn mint_handler(
    State(state): State<AppState>,
    Json(body): Json<MintRequest>,
) -> Result<Json<MintResponse>, StatusCode> {
    // manual auth check
    // manual RPC call
    // manual error mapping
}
```

### After (SSS backend)

Start the pre-built backend:

```bash
cd backend/
cargo run --release
```

Then call the API:

```bash
# Health check
curl http://localhost:8080/health

# Mint tokens (requires API key)
curl -X POST http://localhost:8080/api/mint \
  -H "Authorization: Bearer $SSS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mint":"<MINT_PUBKEY>","amount":1000000,"recipient":"<WALLET>"}'

# Burn tokens
curl -X POST http://localhost:8080/api/burn \
  -H "Authorization: Bearer $SSS_API_KEY" \
  -d '{"mint":"<MINT>","amount":500000,"source":"<TOKEN_ACCOUNT>"}'

# Query supply
curl http://localhost:8080/api/supply?mint=<MINT_PUBKEY>
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | RPC endpoint |
| `SSS_API_KEY` | — | Bearer token for auth (required in production) |
| `RATE_LIMIT_RPM` | `60` | Requests per minute per API key |
| `RATE_LIMIT_BURST` | `10` | Burst allowance |
| `WEBHOOK_SECRET` | — | HMAC secret for webhook payload signing |

### Webhook events

Register a webhook to receive real-time events:

```bash
curl -X POST http://localhost:8080/api/webhooks \
  -H "Authorization: Bearer $SSS_API_KEY" \
  -d '{"url":"https://your-server.com/hook","events":["mint","burn","freeze","blacklist"]}'
```

Each delivery is signed with `X-SSS-Signature: sha256=<hmac>` using your `WEBHOOK_SECRET`.

### Audit log

```bash
# Query audit events with filters
curl "http://localhost:8080/api/compliance/audit?action=mint&limit=20&offset=0" \
  -H "Authorization: Bearer $SSS_API_KEY"

# Pagination
curl "http://localhost:8080/api/compliance/audit?limit=100&offset=100" \
  -H "Authorization: Bearer $SSS_API_KEY"
```

Response includes `X-Total-Count` header for total result count.

---

## 6. Common Pitfalls

### ❌ Using `TOKEN_PROGRAM_ID` instead of `TOKEN_2022_PROGRAM_ID`

SSS mints use Token-2022. Any SPL calls that hardcode the classic `TOKEN_PROGRAM_ID` will fail.

```ts
// ❌ Wrong
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
await mintTo(connection, payer, mint, ata, authority, amount, [], { programId: TOKEN_PROGRAM_ID });

// ✅ Correct — SSS SDK handles this for you
await stablecoin.mintTo({ mint: stablecoin.mint, amount, recipient });
```

### ❌ Missing `initializeBlacklist()` for SSS-2

The transfer hook's extra account meta list must be initialized before any transfer on an SSS-2 mint. If skipped, all transfers fail.

```ts
const compliance = new ComplianceModule(provider, mint, hookProgramId);
await compliance.initializeBlacklist(); // ← must call this once after creating SSS-2 mint
```

### ❌ Confusing blacklist with freeze

- `addToBlacklist(address)` — blocks the **wallet pubkey** across all ATAs. Enforced by the transfer hook.
- `freeze(tokenAccount)` — freezes a **specific ATA**. The wallet can still use other accounts.

Use blacklist for compliance enforcement. Use freeze for temporary account-level holds.

### ❌ Skipping the two-step authority transfer

`updateRoles()` is a single-step update (old behaviour). For production admin handover, use the two-step flow:

```ts
// Step 1: propose new authority
await stablecoin.proposeAuthority({ proposed: newAdminPubkey });

// Step 2: new authority must accept (prevents typos locking out admin)
await stablecoin.acceptAuthority(); // signed by newAdmin
```

Calling `acceptAuthority()` from the wrong keypair will fail on-chain.

### ❌ Amount units

All token amounts are in **base units** (considering decimals). For a 6-decimal token:

```ts
// 1 token = 1_000_000 base units
await stablecoin.mintTo({ amount: 1_000_000n, ... }); // ✅ 1 token
await stablecoin.mintTo({ amount: 1n, ... });          // ⚠️  0.000001 tokens
```

### ❌ Docker build without a Solana toolchain

The backend Dockerfile expects `cargo` on the build host. Use the provided multi-stage build which includes the Rust toolchain:

```bash
docker build -t sss-backend ./backend/
# Takes ~5 min on first build (downloads rust + deps); subsequent builds are cached
```

---

## Further Reading

- [Quick Start Guide](./quickstart.md) — end-to-end walkthrough
- [SDK Core Reference](./on-chain-sdk-core.md) — all `SolanaStablecoin` methods
- [ComplianceModule Reference](./on-chain-sdk-authority-collateral.md) — authority, collateral, compliance
- [Error Handling Guide](./error-handling.md) — `SSSError` codes and retry patterns
- [API Reference](./api.md) — REST API endpoint docs
- [SSS-1 Spec](./SSS-1.md) · [SSS-2 Spec](./SSS-2.md) · [SSS-3 Spec](./SSS-3.md)
