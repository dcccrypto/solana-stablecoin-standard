# SSS — On-Chain SDK: Admin & Governance Methods

> **Feature:** SSS (on-chain program SDK)
> **Class:** `SolanaStablecoin` (sdk/src/SolanaStablecoin.ts)

---

## Overview

The `SolanaStablecoin` class exposes a set of on-chain admin methods that interact directly with the `sss-token` Anchor program via CPI. These complement the off-chain REST/CLI layer and give integrators typed TypeScript wrappers for governance operations: pausing the protocol, managing minters, and transferring authority.

All methods in this section:
- Require the caller's wallet (`provider.wallet`) to be the **admin authority** stored in the on-chain config PDA (unless noted).
- Return a `Promise<TransactionSignature>` that resolves when the transaction is confirmed at the `confirmed` commitment level.
- Lazy-load the Anchor `Program` instance from the embedded IDL (`sdk/src/idl/sss_token.json`) on first call; subsequent calls reuse the cached instance.

---

## Pause / Unpause

### `pause()`

Halts all mint operations by setting the `paused` flag on the config PDA. Existing token accounts and balances are unaffected; only new minting is blocked.

```typescript
const sig = await stablecoin.pause();
console.log('Paused:', sig);
```

**Accounts:**
| Account | Description |
|---------|-------------|
| `config` | Config PDA derived from `[b"stablecoin-config", mint]` |
| `admin` | Wallet public key (must match config.authority) |

**Errors:** `Unauthorized` if caller is not the admin authority.

---

### `unpause()`

Lifts the pause — re-enables minting. Has no effect if the protocol is not currently paused.

```typescript
const sig = await stablecoin.unpause();
console.log('Unpaused:', sig);
```

Accounts and errors are identical to `pause()`.

---

## Minter Management

Minters are registered via a **minter PDA** derived from `[b"minter-info", configPda, minterAuthority]`. Each PDA tracks how much the minter has minted against their cap.

### `updateMinter(params)`

Registers a new minter or updates the cap of an existing one.

```typescript
import { PublicKey } from '@solana/web3.js';

const sig = await stablecoin.updateMinter({
  minter: new PublicKey('Minter11111111111111111111111111111111111111'),
  cap: 1_000_000_000n, // 1,000 tokens at 6 decimals
});
```

Pass `cap: 0n` for an **unlimited** minter (use with care).

**Params:**
| Field | Type | Description |
|-------|------|-------------|
| `minter` | `PublicKey` | The authority to authorize as a minter |
| `cap` | `bigint` | Maximum base-unit tokens this minter may mint in total; `0n` = unlimited |

**Accounts derived automatically:**
- `config` — config PDA
- `minterInfo` — minter PDA (created if new, updated if existing)
- `minterAuthority` — the `params.minter` key
- `admin` — caller wallet
- `systemProgram` — for PDA rent allocation on creation

---

### `revokeMinter(params)`

Closes the minter PDA, removing the minter's authorization. Rent lamports are returned to the admin wallet.

```typescript
const sig = await stablecoin.revokeMinter({
  minter: new PublicKey('Minter11111111111111111111111111111111111111'),
});
```

**Params:**
| Field | Type | Description |
|-------|------|-------------|
| `minter` | `PublicKey` | The minter public key to revoke |

**Errors:** `MinterNotFound` if no minter PDA exists for this key.

---

## Authority Transfer

### `updateRoles(params)`

Transfers the admin authority, compliance authority, or both. Omit any field to leave it unchanged.

```typescript
// Transfer admin authority only
const sig = await stablecoin.updateRoles({
  newAuthority: new PublicKey('NewAdmin111111111111111111111111111111111111'),
});

// Transfer compliance authority only
await stablecoin.updateRoles({
  newComplianceAuthority: new PublicKey('Compliance1111111111111111111111111111111111'),
});

// Transfer both in one transaction
await stablecoin.updateRoles({
  newAuthority: newAdmin,
  newComplianceAuthority: newCompliance,
});
```

> ⚠️ **Irreversible without the new authority's key.** Transfer admin authority only to a key you control. Consider a multisig (`Squads`, `SPL Governance`) for production deployments.

**Params:**
| Field | Type | Description |
|-------|------|-------------|
| `newAuthority` | `PublicKey` _(optional)_ | New admin authority; leave unset to keep current |
| `newComplianceAuthority` | `PublicKey` _(optional)_ | New compliance authority; leave unset to keep current |

**On-chain behaviour:** The program accepts `None` for each optional field (mapped from `null` in the TypeScript SDK) and only writes the provided values.

---

## PDA Helpers

These static helpers are used internally and can also be called directly for account lookups.

### `SolanaStablecoin.getConfigPda(mint, programId?)`

Derives the config PDA for a mint.

```typescript
const [configPda, bump] = SolanaStablecoin.getConfigPda(mint);
```

### `SolanaStablecoin.getMinterPda(configPda, minter, programId?)`

Derives the minter info PDA for a given config PDA and minter authority.

```typescript
const [minterPda, bump] = SolanaStablecoin.getMinterPda(configPda, minterKey);
```

Both helpers default `programId` to `SSS_TOKEN_PROGRAM_ID` and are synchronous (`findProgramAddressSync`).

---

## Program Loading

The `_loadProgram()` private method lazily imports `@coral-xyz/anchor`'s `Program` and the bundled IDL on first use:

```
sdk/src/idl/sss_token.json  ← embedded copy, updated at build time
```

The resolved `Program` instance is cached on the `SolanaStablecoin` instance. A new instance per stablecoin means each has its own cached program; in a long-running backend, prefer reusing a single `SolanaStablecoin` instance.

---

## Type Reference

```typescript
interface UpdateMinterParams {
  minter: PublicKey;          // authority to register/update
  cap: bigint;                // base-unit cap; 0n = unlimited
}

interface RevokeMinterParams {
  minter: PublicKey;          // authority to revoke
}

interface UpdateRolesParams {
  newAuthority?: PublicKey;            // optional new admin
  newComplianceAuthority?: PublicKey;  // optional new compliance authority
}
```

---

## Related

| Guide | Link |
|-------|------|
| SDK & CLI (off-chain REST layer) | [docs/sdk-cli.md](sdk-cli.md) |
| Transfer Hook Program (on-chain blacklist) | [docs/transfer-hook.md](transfer-hook.md) |
| Compliance & Audit Log | [docs/compliance-audit-log.md](compliance-audit-log.md) |
| Anchor Program Tests | [docs/anchor-program-testing.md](anchor-program-testing.md) |
