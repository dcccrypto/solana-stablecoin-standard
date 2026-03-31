# On-Chain SDK — KeeperModule

> **Introduced:** PR #336 — `fix/sdk-anchor-audit-fixes` (merged 2026-03-31)
> **References:** BUG-015 (keeper whitelist), SSS-122 (config migration)

---

## Overview

`KeeperModule` wraps three Anchor instructions that manage the stability-fee
keeper whitelist and on-chain config schema migration.

| Method | Instruction | Auth |
|---|---|---|
| `addAuthorizedKeeper` | `add_authorized_keeper` | stablecoin authority |
| `removeAuthorizedKeeper` | `remove_authorized_keeper` | stablecoin authority |
| `migrateConfig` | `migrate_config` | stablecoin authority |

---

## Installation

```ts
import { KeeperModule } from '@sss/sdk';

const keeper = new KeeperModule(provider, programId);
```

---

## PDA Helpers

### `getConfigPda(mint)`

Returns `[configPda, bump]` — seeds: `[b"stablecoin-config", mint]`.

---

## Methods

### `addAuthorizedKeeper(params)` → `Promise<TransactionSignature>`

Add a pubkey to the stability-fee keeper whitelist (BUG-015).
Authority-only.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint (used to derive `StablecoinConfig` PDA). |
| `keeper` | `PublicKey` | Pubkey to whitelist. |

**Accounts (auto-derived)**

| Account | Description |
|---|---|
| `authority` | Wallet / stablecoin authority (signer). |
| `config` | `StablecoinConfig` PDA — `[b"stablecoin-config", mint]`. |

```ts
await keeper.addAuthorizedKeeper({ mint, keeper: keeperPubkey });
```

---

### `removeAuthorizedKeeper(params)` → `Promise<TransactionSignature>`

Remove a pubkey from the keeper whitelist (BUG-015).
Authority-only.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `keeper` | `PublicKey` | Pubkey to remove. |

```ts
await keeper.removeAuthorizedKeeper({ mint, keeper: keeperPubkey });
```

---

### `migrateConfig(params)` → `Promise<TransactionSignature>`

Migrate a `StablecoinConfig` PDA from v0 → current schema (SSS-122).

- **Idempotent** — safe to call on already-migrated configs.
- **Required** before `mint`/`burn`/`redeem` on configs created with a
  pre-SSS-122 build.
- Only the stablecoin authority may call this.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |

**Accounts (auto-derived)**

| Account | Description |
|---|---|
| `authority` | Wallet / stablecoin authority (signer). |
| `mint` | Stablecoin mint account. |
| `config` | `StablecoinConfig` PDA. |
| `systemProgram` | System program (for realloc if needed). |

```ts
await keeper.migrateConfig({ mint });
```

---

## Full Example

```ts
import { KeeperModule } from '@sss/sdk';

const keeper = new KeeperModule(provider, programId);

// Migrate legacy config (idempotent — safe on mainnet)
await keeper.migrateConfig({ mint });

// Whitelist a keeper bot
await keeper.addAuthorizedKeeper({ mint, keeper: botPubkey });

// Remove a decommissioned keeper
await keeper.removeAuthorizedKeeper({ mint, keeper: oldBotPubkey });
```

---

## Related

- [CIRCUIT-BREAKER-KEEPER.md](CIRCUIT-BREAKER-KEEPER.md) — keeper-operated circuit breaker crank (SSS-152)
- [on-chain-sdk-admin.md](on-chain-sdk-admin.md) — admin authority management
- BUG-015 — keeper whitelist audit fix
- SSS-122 — config schema migration
