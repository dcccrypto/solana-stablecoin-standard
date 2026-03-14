# SSS — ComplianceModule SDK Reference

> **Feature:** SSS-2 (Compliant preset)
> **SDK class:** `ComplianceModule` (`sdk/src/ComplianceModule.ts`)
> **Scope:** On-chain blacklist management + Token-2022 freeze/thaw via the SDK

---

## Overview

`ComplianceModule` is the SDK's high-level interface for SSS-2 compliance operations. It wraps two distinct enforcement mechanisms:

| Mechanism | Enforcement | Effect |
|-----------|-------------|--------|
| **Blacklist** | On-chain (transfer-hook program) | Any transfer to/from a blacklisted address is rejected by the chain |
| **Freeze** | On-chain (Token-2022 freeze authority) | A frozen token account cannot send or receive tokens |

Both mechanisms are fully on-chain — no off-chain middleware can bypass them. The blacklist is enforced by the `sss-transfer-hook` program on every Token-2022 transfer (see [transfer-hook.md](./transfer-hook.md)); freeze/thaw is enforced by the Token-2022 program itself.

> **Note:** The higher-level REST compliance API (see [compliance-audit-log.md](./compliance-audit-log.md)) wraps these SDK calls and appends an immutable audit log entry for each action. For production compliance workflows, prefer the REST API. Use `ComplianceModule` directly when building custom tooling or when you need fine-grained control.

---

## Instantiation

```typescript
import { ComplianceModule } from '@sss/sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  'phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp', // devnet + localnet
);

const compliance = new ComplianceModule(
  provider,         // AnchorProvider — must hold compliance authority keypair
  mintPublicKey,    // PublicKey of the SSS-2 mint
  TRANSFER_HOOK_PROGRAM_ID,
);
```

### Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `AnchorProvider` | Anchor provider; `provider.wallet` must be the compliance authority |
| `mint` | `PublicKey` | Public key of the Token-2022 mint |
| `hookProgramId` | `PublicKey` | Program ID of the deployed `sss-transfer-hook` |

### Authority Requirements

Most mutating methods require the caller (`provider.wallet.publicKey`) to be the **compliance authority** — the wallet that called `initializeBlacklist()`. Read-only methods (`isBlacklisted`, `getBlacklistPda`) have no authority requirement.

---

## Blacklist Methods

### `initializeBlacklist()`

```typescript
async initializeBlacklist(): Promise<TransactionSignature>
```

Initializes the `BlacklistState` PDA for this mint. **Must be called exactly once** after deploying an SSS-2 stablecoin, before any blacklist operations. Sets the caller as the blacklist authority.

> **Note:** When using `SolanaStablecoin.create()` with `sss2Config(...)`, this is called automatically. Only call it directly if you are managing the transfer-hook PDA initialization yourself.

**Accounts used:**

| Account | Description |
|---------|-------------|
| `authority` | `provider.wallet.publicKey` — becomes the blacklist authority |
| `mint` | The SSS-2 mint |
| `blacklistState` | PDA derived from `["blacklist-state", mint]` — created here |

**Example:**

```typescript
const sig = await compliance.initializeBlacklist();
console.log('BlacklistState initialized:', sig);
```

---

### `addToBlacklist(address)`

```typescript
async addToBlacklist(address: PublicKey): Promise<TransactionSignature>
```

Adds a public key to the on-chain blacklist. After this call, any Token-2022 transfer to or from this address will be rejected by the transfer hook — at the chain level, regardless of which wallet or application initiates the transfer.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `PublicKey` | The wallet address to blacklist |

**Requirements:** Caller must be the compliance authority recorded in `BlacklistState`.

**Notes:**
- Idempotent — no-op (and no error) if the address is already blacklisted.
- Fails with `Unauthorized` (error code 6002) if the signer is not the blacklist authority.
- Fails with an account space error if the blacklist is full (capacity: 100 addresses).

**Example:**

```typescript
const suspect = new PublicKey('SomeWalletAddress...');
const sig = await compliance.addToBlacklist(suspect);
console.log('Blacklisted:', sig);
```

---

### `removeFromBlacklist(address)`

```typescript
async removeFromBlacklist(address: PublicKey): Promise<TransactionSignature>
```

Removes a public key from the on-chain blacklist. Transfers to/from this address will be permitted again after the transaction confirms.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `PublicKey` | The wallet address to un-blacklist |

**Requirements:** Caller must be the compliance authority.

**Notes:**
- Idempotent — no-op if the address is not currently blacklisted.

**Example:**

```typescript
const reinstated = new PublicKey('SomeWalletAddress...');
const sig = await compliance.removeFromBlacklist(reinstated);
console.log('Removed from blacklist:', sig);
```

---

### `isBlacklisted(address)`

```typescript
async isBlacklisted(address: PublicKey): Promise<boolean>
```

Reads the `BlacklistState` PDA and checks whether `address` is in the blacklist. This is a **read-only** RPC call — no transaction is submitted.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `PublicKey` | The wallet address to check |

**Returns:** `true` if the address is blacklisted; `false` otherwise (including when the `BlacklistState` PDA does not yet exist).

**Account data layout parsed:**

```
discriminator (8 bytes)
mint          (32 bytes)
authority     (32 bytes)
vec_len       (4 bytes, LE u32)
entries       (vec_len × 32 bytes)
```

**Example:**

```typescript
const flagged = await compliance.isBlacklisted(walletPubkey);
if (flagged) {
  console.log('Address is blacklisted — transfers will be rejected on-chain');
}
```

---

### `getBlacklistPda()`

```typescript
getBlacklistPda(): [PublicKey, number]
```

Synchronously derives the `BlacklistState` PDA for this mint. Useful for fetching the raw account or passing the PDA address to other instructions.

**Returns:** `[pdaPublicKey, bump]`

**Seeds:** `["blacklist-state", mint.toBuffer()]`
**Program:** `hookProgramId`

**Example:**

```typescript
const [blacklistPda, bump] = compliance.getBlacklistPda();
console.log('BlacklistState PDA:', blacklistPda.toBase58());
```

---

## Freeze / Thaw Methods

These methods use the **Token-2022 freeze authority** rather than the transfer hook. Freezing a specific token account prevents that account from sending or receiving tokens, but does not affect the blacklist.

> **Blacklist vs. Freeze:** Blacklisting targets a *wallet address* (all token accounts owned by that address are affected via the transfer hook). Freezing targets a *specific token account*. Use blacklisting for broad compliance restrictions; use freezing for surgical account-level holds.

---

### `freezeAccount(targetTokenAccount)`

```typescript
async freezeAccount(targetTokenAccount: PublicKey): Promise<TransactionSignature>
```

Freezes a Token-2022 token account. The account will be unable to send or receive tokens until thawed.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `targetTokenAccount` | `PublicKey` | The token account to freeze (not the wallet address) |

**Requirements:** `provider.wallet.publicKey` must be the Token-2022 freeze authority for this mint.

**Example:**

```typescript
const tokenAccount = new PublicKey('TokenAccountAddress...');
const sig = await compliance.freezeAccount(tokenAccount);
console.log('Account frozen:', sig);
```

---

### `thawAccount(targetTokenAccount)`

```typescript
async thawAccount(targetTokenAccount: PublicKey): Promise<TransactionSignature>
```

Thaws a previously frozen token account, restoring transfer capability.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `targetTokenAccount` | `PublicKey` | The token account to thaw |

**Requirements:** `provider.wallet.publicKey` must be the Token-2022 freeze authority for this mint.

**Example:**

```typescript
const sig = await compliance.thawAccount(tokenAccount);
console.log('Account thawed:', sig);
```

---

## Program Loading

The Anchor program instance for the transfer-hook IDL is **lazy-loaded and cached** the first time any mutating blacklist method is called. Subsequent calls reuse the cached instance — there is no overhead for repeated operations on the same `ComplianceModule` instance.

Freeze/thaw methods do **not** load the Anchor program; they call the `@solana/spl-token` helpers directly.

---

## Error Reference

Errors from blacklist instructions originate in the transfer-hook program:

| Error | Code | Condition |
|-------|------|-----------|
| `SenderBlacklisted` | 6000 | Transfer hook: sender is blacklisted |
| `ReceiverBlacklisted` | 6001 | Transfer hook: receiver is blacklisted |
| `Unauthorized` | 6002 | Caller is not the blacklist authority |

---

## Full Example: SSS-2 Compliance Workflow

```typescript
import { ComplianceModule } from '@sss/sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  'phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp',
);

const compliance = new ComplianceModule(
  provider,
  mintPublicKey,
  TRANSFER_HOOK_PROGRAM_ID,
);

// --- Setup (run once per mint) ---
// (Skipped if using SolanaStablecoin.create() with sss2Config — it calls this automatically)
await compliance.initializeBlacklist();

// --- Blacklist a bad actor ---
const badActor = new PublicKey('BadActorWalletAddress...');
await compliance.addToBlacklist(badActor);

// --- Verify ---
const blocked = await compliance.isBlacklisted(badActor);
console.log('Is blacklisted:', blocked); // true

// --- Reinstate after review ---
await compliance.removeFromBlacklist(badActor);

// --- Freeze a specific token account (e.g., during investigation) ---
const suspectTokenAccount = new PublicKey('TokenAccountAddress...');
await compliance.freezeAccount(suspectTokenAccount);

// --- Thaw after investigation clears ---
await compliance.thawAccount(suspectTokenAccount);
```

---

## Related Docs

- [transfer-hook.md](./transfer-hook.md) — on-chain transfer-hook program reference (instructions, errors, account layout)
- [compliance-audit-log.md](./compliance-audit-log.md) — REST API for compliance actions with immutable audit logging
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — `SolanaStablecoin` SDK core reference (initialize, mint, burn)
- [devnet-deploy.md](./devnet-deploy.md) — deployment flow including transfer-hook registration
