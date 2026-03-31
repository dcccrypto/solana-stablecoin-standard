# On-Chain SDK — InsuranceVaultModule

> **Introduced:** PR #336 — `fix/sdk-anchor-audit-fixes` (merged 2026-03-31)
> **References:** SSS-151

---

## Overview

`InsuranceVaultModule` manages the on-chain insurance vault that protects
against bad-debt shortfalls.  Seeding and replenishment are open to any
depositor; draws require the stablecoin authority (and DAO approval when
`FLAG_DAO_COMMITTEE` is active).

Feature flag: `FLAG_INSURANCE_VAULT_REQUIRED` = bit 14 (`0x4000`).

| Method | Instruction | Auth |
|---|---|---|
| `initInsuranceVault` | `init_insurance_vault` | stablecoin authority |
| `seedInsuranceVault` | `seed_insurance_vault` | any depositor |
| `replenishInsuranceVault` | `replenish_insurance_vault` | any contributor |
| `drawInsurance` | `draw_insurance` | stablecoin authority (+ DAO if flag set) |

---

## Installation

```ts
import { InsuranceVaultModule, FLAG_INSURANCE_VAULT_REQUIRED } from '@sss/sdk';

const vault = new InsuranceVaultModule(provider, programId);
```

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `FLAG_INSURANCE_VAULT_REQUIRED` | `1n << 14n` | Feature flag bit for insurance vault requirement. |

---

## PDA Helpers

### `getConfigPda(mint)` → `[PublicKey, number]`
Seeds: `[b"stablecoin-config", mint]`

### `getInsuranceVaultPda(mint)` → `[PublicKey, number]`
Seeds: `[b"insurance-vault", mint]`

---

## Methods

### `initInsuranceVault(params)` → `Promise<TransactionSignature>`

Initialise the `InsuranceVault` PDA.  Must be called before seeding.
Requires `FLAG_INSURANCE_VAULT_REQUIRED` to be set on the config.
Authority-only.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `vaultTokenAccount` | `PublicKey` | Token account that will hold vault collateral. |
| `minSeedBps` | `number` | Minimum seed as basis points of supply (e.g. `100` = 1%). |
| `maxDrawPerEventBps` | `number` | Maximum single-draw as basis points of vault balance. |

---

### `seedInsuranceVault(params)` → `Promise<TransactionSignature>`

Initial funding of the vault.  Open to any depositor.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `depositorTokenAccount` | `PublicKey` | Source token account. |
| `vaultTokenAccount` | `PublicKey` | Vault token account. |
| `collateralMint` | `PublicKey` | Collateral mint. |
| `amount` | `bigint \| number` | Amount to deposit (raw token units). |

---

### `replenishInsuranceVault(params)` → `Promise<TransactionSignature>`

Add collateral to an already-seeded vault.  Open to any contributor.
Same parameters as `seedInsuranceVault`.

---

### `drawInsurance(params)` → `Promise<TransactionSignature>`

Draw collateral from the vault to cover a bad-debt event.  Authority-only.
When `FLAG_DAO_COMMITTEE` is active, `daoProposal` must be provided.
Draw amount is capped by `maxDrawPerEventBps`.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `vaultTokenAccount` | `PublicKey` | Vault source token account. |
| `destinationTokenAccount` | `PublicKey` | Destination for drawn collateral. |
| `collateralMint` | `PublicKey` | Collateral mint. |
| `amount` | `bigint \| number` | Amount to draw (raw token units). |
| `reasonHash` | `Uint8Array` (32 bytes) | SHA-256 hash of the draw reason string. |
| `daoProposal?` | `PublicKey` | DAO proposal account (required when `FLAG_DAO_COMMITTEE` is set). |

---

## Full Example

```ts
import { InsuranceVaultModule, FLAG_INSURANCE_VAULT_REQUIRED } from '@sss/sdk';
import { createHash } from 'crypto';

const vault = new InsuranceVaultModule(provider, programId);

// 1. Init vault (authority)
await vault.initInsuranceVault({
  mint,
  vaultTokenAccount,
  minSeedBps: 100,       // 1% of supply
  maxDrawPerEventBps: 1000, // 10% per event
});

// 2. Seed (any depositor)
await vault.seedInsuranceVault({ mint, depositorTokenAccount, vaultTokenAccount, collateralMint, amount: 1_000_000n });

// 3. Draw to cover bad debt (authority)
const reasonHash = new Uint8Array(createHash('sha256').update('CDP liquidation shortfall 2026-03-31').digest());
await vault.drawInsurance({ mint, vaultTokenAccount, destinationTokenAccount, collateralMint, amount: 50_000n, reasonHash });
```

---

## Related

- [INSURANCE-VAULT.md](INSURANCE-VAULT.md) — insurance vault design (SSS-151)
- [on-chain-sdk-backstop.md](on-chain-sdk-backstop.md) — bad debt backstop module
