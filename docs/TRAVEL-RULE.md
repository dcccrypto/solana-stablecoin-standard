# Travel Rule Compliance — SSS-127

## Overview

SSS-127 implements FATF Travel Rule compliance infrastructure for the Solana Stablecoin Standard (SSS) program. The Travel Rule (FATF Recommendation 16) requires Virtual Asset Service Providers (VASPs) to share originator and beneficiary information for transfers at or above a configured threshold.

This implementation is VASP-agnostic: any compliant VASP (Chainalysis, Elliptic, TRM, or a custom solution) can integrate by submitting a `TravelRuleRecord` PDA in the same transaction as a qualifying transfer.

---

## Architecture

### Feature Flag

| Constant             | Bit | Value |
|----------------------|-----|-------|
| `FLAG_TRAVEL_RULE`   | 8   | 256   |

Enable via `set_feature_flag` with value `256`.

### Config Field

```
StablecoinConfig.travel_rule_threshold: u64
```

- `0` = Travel Rule enforcement disabled (threshold not reached by any transfer).
- `> 0` = Transfers with `amount >= travel_rule_threshold` require a `TravelRuleRecord`.

Set via `set_travel_rule_threshold` (authority-only).

### TravelRuleRecord PDA

**Seeds:** `["travel-rule-record", sss_mint, nonce_le_bytes_8]`

| Field                | Type        | Description                                           |
|----------------------|-------------|-------------------------------------------------------|
| `sss_mint`           | `Pubkey`    | The SSS stablecoin mint                               |
| `nonce`              | `u64`       | Caller-chosen monotonic nonce (unique per transfer)   |
| `encrypted_payload`  | `[u8; 256]` | VASP data encrypted to beneficiary VASP key (opaque)  |
| `originator_vasp`    | `Pubkey`    | Pubkey of the originating VASP                        |
| `beneficiary_vasp`   | `Pubkey`    | Pubkey of the beneficiary VASP                        |
| `transfer_amount`    | `u64`       | Transfer amount this record covers                    |
| `slot`               | `u64`       | Solana slot at submission                             |
| `bump`               | `u8`        | PDA bump                                              |

---

## Instructions

### `set_travel_rule_threshold`

Set the transfer amount threshold in token native units. Setting to `0` disables threshold enforcement (note: `FLAG_TRAVEL_RULE` must also be unset to fully disable).

```ts
await program.methods
  .setTravelRuleThreshold(new BN(1_000_000_000)) // 1,000 USDC (6 decimals)
  .accounts({ authority: authority.publicKey, config })
  .signers([authority])
  .rpc();
```

**Accounts:**
| Account    | Writable | Signer | Description              |
|------------|----------|--------|--------------------------|
| `authority`| ✗        | ✓      | Stablecoin authority     |
| `config`   | ✓        | ✗      | StablecoinConfig PDA     |

---

### `submit_travel_rule_record`

Submit VASP-to-VASP compliance data for a qualifying transfer. **Must be called in the same transaction as the transfer.**

```ts
const nonce = BigInt(Date.now()); // or a counter from your VASP backend
const nonceBuf = Buffer.alloc(8);
nonceBuf.writeBigUInt64LE(nonce);

const [recordPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("travel-rule-record"), mint.toBuffer(), nonceBuf],
  programId
);

await program.methods
  .submitTravelRuleRecord(
    new BN(nonce.toString()),
    encryptedPayload,      // Uint8Array(256)
    beneficiaryVasp,       // Pubkey
    new BN(transferAmount) // token native units
  )
  .accounts({
    originatorVaspSigner: originatorVasp.publicKey,
    config,
    travelRuleRecord: recordPda,
    systemProgram: SystemProgram.programId,
  })
  .signers([originatorVasp])
  .rpc();
```

**Accounts:**
| Account                 | Writable | Signer | Description                          |
|-------------------------|----------|--------|--------------------------------------|
| `originatorVaspSigner`  | ✓        | ✓      | Originating VASP (pays rent)         |
| `config`                | ✗        | ✗      | StablecoinConfig PDA                 |
| `travelRuleRecord`      | ✓        | ✗      | New TravelRuleRecord PDA (init)      |
| `systemProgram`         | ✗        | ✗      | System program                       |

---

### `close_travel_rule_record`

Close a TravelRuleRecord PDA after the transfer settles and reclaim rent. Only the original submitter (originator VASP) may close.

```ts
await program.methods
  .closeTravelRuleRecord(new BN(nonce.toString()))
  .accounts({
    originatorVaspSigner: originatorVasp.publicKey,
    travelRuleRecord: recordPda,
  })
  .signers([originatorVasp])
  .rpc();
```

---

## Transfer Hook Integration

When `FLAG_TRAVEL_RULE` is active and a transfer's amount meets or exceeds `travel_rule_threshold`, the transfer hook calls `verify_travel_rule_if_required` to confirm:

1. A `TravelRuleRecord` PDA exists with the correct seeds.
2. `record.sss_mint == config.mint`.
3. `record.transfer_amount == transfer_amount`.
4. `record.beneficiary_vasp == expected_beneficiary_vasp`.

If any check fails, the transfer is rejected with one of:
- `TravelRuleRequired` — record not found.
- `TravelRuleRecordInvalid` — fields do not match.

---

## Payload Encryption

The `encrypted_payload` field is 256 bytes and **opaque to the program** — the on-chain layer only stores and verifies presence. VASP providers are responsible for:

1. Encrypting originator/beneficiary data using an agreed-upon scheme (e.g., ECIES with X25519 + AES-256-GCM) to the beneficiary VASP's key.
2. Off-chain transmission of decryption keys or using the on-chain record as a commitment.

Recommended fields in plaintext (before encryption):
```json
{
  "originator": { "name": "Alice Smith", "accountNumber": "...", "address": "..." },
  "beneficiary": { "name": "Bob Jones",  "accountNumber": "...", "address": "..." },
  "transferRef": "uuid-or-hash"
}
```

---

## Error Codes

| Code                        | Description                                                  |
|-----------------------------|--------------------------------------------------------------|
| `TravelRuleRequired`        | Transfer meets threshold but no TravelRuleRecord found       |
| `TravelRuleRecordInvalid`   | Record exists but amount or beneficiary_vasp does not match  |
| `TravelRuleThresholdNotSet` | FLAG_TRAVEL_RULE active but threshold is 0                   |

---

## Setup Checklist

1. **Enable the flag:**
   ```ts
   await program.methods.setFeatureFlag(new BN(256)) // FLAG_TRAVEL_RULE = 1 << 8
     .accounts({ authority, config }).signers([authority]).rpc();
   ```

2. **Set the threshold** (e.g., 1 000 USDC with 6 decimals = `1_000_000_000`):
   ```ts
   await program.methods.setTravelRuleThreshold(new BN(1_000_000_000))
     .accounts({ authority, config }).signers([authority]).rpc();
   ```

3. **In each qualifying transaction**, include `submit_travel_rule_record` as the first instruction, followed by the token transfer.

4. **After transfer settles**, call `close_travel_rule_record` to reclaim rent.

---

## Backend API (SSS-127 Indexer)

The SSS backend automatically indexes every `TravelRuleRecordSubmitted` event into a local SQLite table (`travel_rule_records`) via the event indexer.  Two REST endpoints expose this data.

### `GET /api/travel-rule/records`

Returns indexed TravelRuleRecord events, newest first.

**Query parameters:**

| Parameter | Type   | Required | Description                                                              |
|-----------|--------|----------|--------------------------------------------------------------------------|
| `wallet`  | string | **Yes**  | VASP pubkey to query — matches `originator_vasp` OR `beneficiary_vasp`. Must be non-empty. |
| `mint`    | string | No       | Filter by SSS stablecoin mint address                                    |
| `limit`   | u32    | No       | Max rows to return (default: 100, max: 1 000)                            |

> **Security note (AUDIT3C-M3):** The `wallet` parameter is **required**. Omitting it or passing an empty/whitespace value returns HTTP `400 BAD_REQUEST`. This prevents cross-VASP data leakage that would occur if all records were returned without scoping by VASP identity.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-v4",
      "mint": "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat",
      "nonce": 1711234567890,
      "originator_vasp": "<base58 pubkey>",
      "beneficiary_vasp": "<base58 pubkey>",
      "transfer_amount": 1000000000,
      "slot": 312456789,
      "encrypted_payload": "<base64 ECIES blob>",
      "tx_signature": "<base58 sig>",
      "created_at": "2026-03-24T00:20:27Z"
    }
  ]
}
```

**Error response (missing/empty wallet):**
```json
{ "success": false, "error": "wallet parameter is required and must not be empty" }
```
HTTP status: `400 BAD_REQUEST`

**Example:**
```bash
# Records for a VASP wallet (wallet is required)
curl "https://api.example.com/api/travel-rule/records?wallet=<originatorVasp>&limit=50"

# With mint filter
curl "https://api.example.com/api/travel-rule/records?wallet=<originatorVasp>&mint=AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"
```

---

### `POST /api/admin/travel-rule/records`

> **AUDIT3C-H1 (HIGH — fixed 4fb190c):** Admin-only endpoint (requires `require_admin` middleware — supply a valid admin bearer token). Submits a new TravelRuleRecord. Both `originator_vasp` and `beneficiary_vasp` are validated against the backend's **known VASP registry** (`known_vasps` table). Unrecognised VASP identifiers are rejected with `422 UNKNOWN_VASP` — they are never persisted. Input values are validated server-side: `mint` must be non-empty, `amount` and `threshold` must be non-negative.

**Request body (JSON):**

| Field             | Type    | Required | Description                                               |
|-------------------|---------|----------|-----------------------------------------------------------|
| `originator_vasp` | string  | ✓        | Registered VASP ID for the originating party              |
| `beneficiary_vasp`| string  | ✓        | Registered VASP ID for the beneficiary party              |
| `mint`            | string  | ✓        | SSS stablecoin mint address (must be non-empty)           |
| `amount`          | i64     | ✓        | Transfer amount in token native units (must be ≥ 0)       |
| `threshold`       | i64     | ✓        | Threshold amount at time of submission (must be ≥ 0)      |
| `compliant`       | bool    | ✓        | Whether transfer meets travel-rule requirements           |
| `tx_signature`    | string  | No       | On-chain transaction signature                            |

**Responses:**

| Status | Meaning                                                                              |
|--------|--------------------------------------------------------------------------------------|
| 201    | Created — record accepted, returns full `TravelRuleRecord` object                    |
| 401    | Unauthorized — missing or invalid admin bearer token                                 |
| 422    | `UNKNOWN_VASP` — one or both VASPs not found in the registry                         |
| 422    | `UnprocessableEntity` — empty mint, negative amount, or negative threshold           |
| 503    | `FLAG_TRAVEL_RULE` is not set in `StablecoinConfig.feature_flags`                    |

**Example (success):**
```bash
curl -X POST "https://api.example.com/api/admin/travel-rule/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "originator_vasp": "SSSISSUER001",
    "beneficiary_vasp": "SSSMARKET001",
    "mint": "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat",
    "amount": 1000000000,
    "threshold": 1000000000,
    "compliant": true,
    "tx_signature": "5A3f..."
  }'
```

**Example (unknown VASP — 422):**
```bash
curl -X POST "https://api.example.com/api/admin/travel-rule/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"originator_vasp": "FORGEDVASP99", "beneficiary_vasp": "SSSMARKET001", ...}'
# → HTTP 422: {"success": false, "error": "unknown VASP: FORGEDVASP99"}
```

**Example (invalid input — 422):**
```bash
curl -X POST "https://api.example.com/api/admin/travel-rule/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"originator_vasp": "SSSISSUER001", "beneficiary_vasp": "SSSMARKET001", "mint": "", "amount": -1, "threshold": 0, "compliant": true}'
# → HTTP 422: {"success": false, "error": "mint must not be empty"}
```

**Known VASPs (seeded):**

| VASP ID          | Description                                  |
|------------------|----------------------------------------------|
| `SSSISSUER001`   | SSS Issuer (default)                         |
| `SSSMARKET001`   | SSS Market Maker (default)                   |
| `TESTVASP0001`   | Test VASP (**devnet/localnet only** — not seeded in production) |

> New VASPs must be inserted into `known_vasps` by an admin before they can submit records. Seed entries can be extended via migration.

---

### `GET /api/pid-config`

Returns SSS program IDs and the current travel-rule operational configuration.

**Response:**
```json
{
  "sss_token_program_id": "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat",
  "sss_transfer_hook_program_id": "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp",
  "travel_rule_indexing_active": true,
  "travel_rule_threshold": 1000000000
}
```

| Field                         | Description                                                                                     |
|-------------------------------|-------------------------------------------------------------------------------------------------|
| `sss_token_program_id`        | On-chain SSS token program address                                                              |
| `sss_transfer_hook_program_id`| On-chain transfer-hook program address                                                          |
| `travel_rule_indexing_active` | Always `true` when the backend is running                                                       |
| `travel_rule_threshold`       | From `TRAVEL_RULE_THRESHOLD` env var (set by devops from on-chain `StablecoinConfig`); `0` = unset |

> **Devops note:** After calling `set_travel_rule_threshold` on-chain, update the `TRAVEL_RULE_THRESHOLD` environment variable on the backend deployment so `/api/pid-config` reflects the live value.

---

### Indexer Details

- **Event pattern:** `TravelRuleRecordSubmitted` (Anchor discriminant).
- **Storage:** `travel_rule_records` table in the backend SQLite DB.
- **Deduplication:** `UNIQUE INDEX` on `(mint, nonce)` — duplicate submissions from chain re-scans are silently ignored (`INSERT OR IGNORE`).
- **Indexed fields:** `originator_vasp`, `beneficiary_vasp`, `mint` each have individual indices for fast VASP-lookup queries.

---

## Compliance Notes

- **FATF threshold:** The FATF recommendation is 1 000 USD/EUR. Set `travel_rule_threshold` to the appropriate token amount for your stablecoin's peg.
- **Record retention:** Close records only after your compliance system has archived the data off-chain. On-chain records are not a long-term audit log.
- **Counterparty VASP discovery:** This implementation does not handle VASP discovery (e.g., OpenVASP, TRISA). That is an off-chain concern.
- **Sanctions screening:** Use SSS-128 (Sanctions Screening Oracle) alongside Travel Rule for full AML/CFT compliance.
