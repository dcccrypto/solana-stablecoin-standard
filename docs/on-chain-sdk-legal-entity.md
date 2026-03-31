# On-Chain SDK — LegalEntityModule

> **Introduced:** PR #336 — `fix/sdk-anchor-audit-fixes` (merged 2026-03-31)
> **References:** SSS-136 / LEGAL-ENTITY-REGISTRY.md, FLAG_LEGAL_REGISTRY (bit 5)

---

## Overview

`LegalEntityModule` manages on-chain legal entity registration for stablecoin
issuers.  It enforces KYC/AML compliance metadata on-chain via the
`IssuerRegistry` PDA.

Feature flag: `FLAG_LEGAL_REGISTRY` = bit 5 (`0x20`).

| Method | Instruction | Auth |
|---|---|---|
| `registerLegalEntity` | `register_legal_entity` | stablecoin authority |
| `updateLegalEntity` | `update_legal_entity` | stablecoin authority |
| `attestLegalEntity` | `attest_legal_entity` | stablecoin authority |
| `fetchIssuerRegistry` | read | — |

---

## Installation

```ts
import { LegalEntityModule, FLAG_LEGAL_REGISTRY } from '@sss/sdk';

const legal = new LegalEntityModule(provider, programId);
```

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `FLAG_LEGAL_REGISTRY` | `1n << 5n` | Feature flag bit enabling legal entity registry enforcement. |

---

## Types

### `IssuerRegistryAccount`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `legalName` | `string` | Registered legal name of the issuer. |
| `jurisdiction` | `string` | ISO 3166-1 alpha-2 country code (e.g. `"DE"`). |
| `licenseId` | `string` | Regulatory licence identifier. |
| `attested` | `boolean` | Whether the registration has been attested. |
| `attestedAt` | `bigint \| null` | Unix timestamp of attestation. |

---

## Methods

### `registerLegalEntity(params)` → `Promise<TransactionSignature>`

Create the `IssuerRegistry` PDA.  Requires `FLAG_LEGAL_REGISTRY` to be
enabled on the stablecoin config.  Authority-only.

**Params** (`RegisterLegalEntityParams`)

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `legalName` | `string` | Legal name of the issuer. |
| `jurisdiction` | `string` | ISO 3166-1 alpha-2 code. |
| `licenseId` | `string` | Regulatory licence ID. |

```ts
await legal.registerLegalEntity({
  mint,
  legalName: 'Acme Stablecoin GmbH',
  jurisdiction: 'DE',
  licenseId: 'BAFIN-2026-12345',
});
```

---

### `updateLegalEntity(params)` → `Promise<TransactionSignature>`

Update the `IssuerRegistry` PDA fields.  Accepts the same parameters as
`registerLegalEntity`.  Clears the `attested` flag — re-attest after update.

```ts
await legal.updateLegalEntity({ mint, legalName: 'Acme Finance GmbH', jurisdiction: 'DE', licenseId: 'BAFIN-2027-99999' });
```

---

### `attestLegalEntity(mint)` → `Promise<TransactionSignature>`

Mark the `IssuerRegistry` as attested (sets `attested = true` and records
`attested_at` timestamp on-chain).  Authority-only.  Idempotent.

```ts
await legal.attestLegalEntity(mint);
```

---

### `fetchIssuerRegistry(mint)` → `Promise<IssuerRegistryAccount | null>`

Fetch and deserialise the `IssuerRegistry` PDA.  Returns `null` if not
initialised.

```ts
const registry = await legal.fetchIssuerRegistry(mint);
if (registry?.attested) {
  console.log('Attested at slot', registry.attestedAt);
}
```

---

## Full Example

```ts
import { LegalEntityModule } from '@sss/sdk';

const legal = new LegalEntityModule(provider, programId);

// Register
await legal.registerLegalEntity({ mint, legalName: 'Acme Stablecoin GmbH', jurisdiction: 'DE', licenseId: 'BAFIN-2026-12345' });

// Attest
await legal.attestLegalEntity(mint);

// Verify
const reg = await legal.fetchIssuerRegistry(mint);
console.assert(reg?.attested, 'must be attested');
```

---

## Related

- [LEGAL-ENTITY-REGISTRY.md](LEGAL-ENTITY-REGISTRY.md) — legal entity registry design
- [MICA-COMPLIANCE.md](MICA-COMPLIANCE.md) — MiCA compliance docs
