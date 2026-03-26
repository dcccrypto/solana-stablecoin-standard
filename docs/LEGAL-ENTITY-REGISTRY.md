# Legal Entity Registry — SSS-156

## Overview

The **Issuer Legal Entity Registry** is an optional on-chain record that allows regulated stablecoin issuers to bind their legal identity to their on-chain program. It is enabled by setting **FLAG_LEGAL_REGISTRY (bit 24)** and creates an `IssuerRegistry` PDA per stablecoin config.

This feature is designed to support regulatory traceability without exposing sensitive data on-chain. All identifying information is stored as SHA-256 hashes; only the jurisdiction code is stored in plaintext.

---

## Feature Flag

| Flag | Bit | Value |
|------|-----|-------|
| `FLAG_LEGAL_REGISTRY` | 24 | `1 << 24` |

Enabling this flag creates an `IssuerRegistry` PDA. The flag is set automatically by `register_legal_entity`.

---

## IssuerRegistry PDA

**Seeds:** `["issuer_registry", config_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The StablecoinConfig this registry belongs to |
| `legal_entity_hash` | `[u8; 32]` | SHA-256 of the legal entity document (articles of incorporation, etc.) |
| `jurisdiction` | `[u8; 4]` | ISO 3166-1 alpha-2 country code (e.g. `US\0\0`, `GB\0\0`) |
| `registration_number_hash` | `[u8; 32]` | SHA-256 of the jurisdiction registration number string |
| `attestor` | `Pubkey` | Notary/lawyer who will co-sign this record |
| `attested_slot` | `u64` | Slot at which the attestor signed (0 = not yet attested) |
| `expiry_slot` | `u64` | Slot after which the record is considered expired (0 = no expiry) |
| `attested` | `bool` | True after `attest_legal_entity` succeeds |
| `bump` | `u8` | PDA bump seed |

---

## Instructions

### `register_legal_entity`

**Authority-only.** Creates the `IssuerRegistry` PDA and enables `FLAG_LEGAL_REGISTRY` on the config.

**Parameters:**
- `legal_entity_hash: [u8; 32]` — SHA-256 of the legal entity document. Must be non-zero.
- `jurisdiction: [u8; 4]` — ISO 3166-1 alpha-2 code, zero-padded. Must be non-zero.
- `registration_number_hash: [u8; 32]` — SHA-256 of the registration number. Must be non-zero.
- `attestor: Pubkey` — Pubkey of the notary who will attest. Must be non-zero.
- `expiry_slot: u64` — 0 = no expiry; otherwise must be a future slot.

**Emits:** `LegalEntityRegistered`

**Accounts:**
```
authority          (mut, signer)
config             (mut)
issuer_registry    (init, pda)
system_program
```

---

### `attest_legal_entity`

**Attestor-only.** The designated attestor (notary/lawyer) co-signs the registry record.

Sets `attested = true` and records `attested_slot`. A record must be re-attested after any update via `update_legal_entity`.

**Parameters:** None

**Emits:** `LegalEntityAttested`

**Accounts:**
```
attestor           (signer — must match registry.attestor)
config
issuer_registry    (mut)
```

**Guards:**
- Signer must be `registry.attestor`
- Cannot double-attest (use `update_legal_entity` to reset)
- Cannot attest an expired record

---

### `update_legal_entity`

**Authority-only.** Updates the legal entity record with new details. Resets `attested = false` — the attestor must re-sign via `attest_legal_entity`.

**Parameters:** Same as `register_legal_entity` (new values)

**Emits:** `LegalEntityUpdated`

**Accounts:**
```
authority          (mut, signer)
config
issuer_registry    (mut, pda)
```

---

## Events

### `LegalEntityRegistered`
```
sss_mint                  Pubkey
legal_entity_hash         [u8; 32]
jurisdiction              [u8; 4]
registration_number_hash  [u8; 32]
attestor                  Pubkey
expiry_slot               u64
```

### `LegalEntityAttested`
```
sss_mint      Pubkey
attestor      Pubkey
attested_slot u64
```

### `LegalEntityUpdated`
```
sss_mint                  Pubkey
legal_entity_hash         [u8; 32]
jurisdiction              [u8; 4]
registration_number_hash  [u8; 32]
attestor                  Pubkey
expiry_slot               u64
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `InvalidLegalEntityHash` | `legal_entity_hash` or `registration_number_hash` is all-zeros |
| `InvalidLegalEntityJurisdiction` | `jurisdiction` is all-zeros |
| `InvalidLegalEntityAttestor` | `attestor` is the zero pubkey |
| `LegalEntityAlreadyAttested` | Record is already attested; call `update_legal_entity` first |
| `LegalEntityExpired` | `expiry_slot` has passed |

---

## Regulatory Verification Flow

Regulators can verify an issuer's legal identity as follows:

1. **Fetch the PDA on-chain:**
   Derive `[b"issuer_registry", config_pubkey]` and fetch the `IssuerRegistry` account.

2. **Check attestation:**
   Verify `attested == true` and `attested_slot > 0`.

3. **Verify expiry:**
   If `expiry_slot != 0`, check that the current slot is ≤ `expiry_slot`.

4. **Match document hash:**
   The issuer provides the legal entity document off-chain. Compute SHA-256 and compare against `legal_entity_hash`.

5. **Match registration number:**
   The issuer provides their registration number. Compute SHA-256 and compare against `registration_number_hash`.

6. **Verify attestor identity:**
   The issuer provides the attestor's identity (e.g. law firm name, bar number). The regulator independently verifies the `attestor` Pubkey belongs to that notary.

---

## Privacy Design

- **Hashed fields:** Legal entity document and registration number are stored as SHA-256 hashes, not plaintext. The issuer shares these off-chain only with authorized parties.
- **Jurisdiction in plaintext:** The ISO country code is stored in plaintext to support on-chain routing logic (e.g. MiCA compliance checks).
- **No PII on-chain:** No names, addresses, or registration numbers appear on-chain.

---

## Integration with MiCA / GENIUS Act

This registry provides a traceability anchor for:
- **MiCA Article 68**: E-money token issuers must be authorized credit institutions or e-money institutions. The `jurisdiction` + hashed registration number allows MiCA supervisors to cross-reference the on-chain entity with their registry.
- **GENIUS Act (proposed)**: Stablecoin issuers must disclose their legal entity. This PDA serves as the on-chain disclosure point.

Refer to `docs/MICA-COMPLIANCE.md` and `docs/GENIUS-ACT.md` for the full compliance mapping.

---

## Example: Registering a Legal Entity (TypeScript SDK)

```typescript
import { PublicKey } from "@solana/web3.js";
import crypto from "crypto";

const legalEntityDoc = fs.readFileSync("articles-of-incorporation.pdf");
const legalEntityHash = Array.from(crypto.createHash("sha256").update(legalEntityDoc).digest());

const regNumber = "DE-123456789";
const registrationNumberHash = Array.from(
  crypto.createHash("sha256").update(regNumber).digest()
);

const jurisdiction = Buffer.from("DE\0\0"); // Germany

await program.methods
  .registerLegalEntity(
    legalEntityHash,
    Array.from(jurisdiction),
    registrationNumberHash,
    attestorPubkey,
    new BN(0) // no expiry
  )
  .accounts({ authority, config, issuerRegistry, systemProgram })
  .signers([authorityKeypair])
  .rpc();
```

---

## Example: Verifying On-Chain (TypeScript)

```typescript
const [registryPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("issuer_registry"), configKey.toBuffer()],
  programId
);

const registry = await program.account.issuerRegistry.fetch(registryPda);

const isValid =
  registry.attested &&
  (registry.expirySlot.toNumber() === 0 || currentSlot <= registry.expirySlot.toNumber());

console.log("Attested:", isValid);
console.log("Jurisdiction:", Buffer.from(registry.jurisdiction).toString("utf8").replace(/\0/g, ""));
```
