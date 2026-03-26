# Sanctions Oracle (SSS-128)

Pluggable OFAC/sanctions list integration for SSS stablecoins. Enables issuers to register a compliance provider (Chainalysis, Elliptic, TRM, etc.) as an on-chain oracle that flags sanctioned wallets. The transfer hook blocks transfers from any flagged address.

---

## Overview

When enabled, the sanctions oracle path works as follows:

1. **Authority** calls `set_sanctions_oracle(oracle, max_staleness_slots)` — registers a compliance provider's signer pubkey and sets the staleness window.
2. **Oracle signer** calls `update_sanctions_record(wallet, is_sanctioned)` — creates/updates a `SanctionsRecord` PDA per wallet.
3. **Transfer hook** reads the sender's `SanctionsRecord` on every transfer. If `is_sanctioned = true` and the record is fresh, the transfer is rejected with `SanctionedAddress`.
4. **Authority** calls `clear_sanctions_oracle()` to disable the path.

The feature is gated by `FLAG_SANCTIONS_ORACLE` (bit 9, value `512`) on `StablecoinConfig.feature_flags`.

---

## Accounts

### `StablecoinConfig` (additions)

| Field | Type | Description |
|---|---|---|
| `sanctions_oracle` | `Pubkey` | Registered oracle signer. `Pubkey::default()` = disabled. |
| `sanctions_max_staleness_slots` | `u64` | Max age of a `SanctionsRecord` before it is considered stale. `0` = no staleness check (record is authoritative indefinitely). |

### `SanctionsRecord` PDA

Seeds: `["sanctions-record", sss_mint, wallet_pubkey]`

| Field | Type | Description |
|---|---|---|
| `is_sanctioned` | `bool` | Whether this wallet is currently flagged. |
| `updated_slot` | `u64` | Slot at which the oracle last updated this record. |
| `bump` | `u8` | PDA bump. |

When `FLAG_SANCTIONS_ORACLE` is active, the `SanctionsRecord` PDA **must** be passed in `remaining_accounts` on every transfer. If it is omitted the transfer is rejected with `SanctionsRecordMissingBug003` (fail-closed — see Security below).

---

## Instructions

### `set_sanctions_oracle(oracle, max_staleness_slots)`

Registers an oracle and enables the sanctions path.

- **Signer:** `authority` (must match `config.authority`)
- Sets `config.sanctions_oracle = oracle`
- Sets `config.sanctions_max_staleness_slots = max_staleness_slots`
- Sets `FLAG_SANCTIONS_ORACLE` on `config.feature_flags`
- Emits `SanctionsOracleSet { mint, oracle, max_staleness_slots }`

### `clear_sanctions_oracle()`

Disables the sanctions oracle path.

- **Signer:** `authority`
- Resets `sanctions_oracle` to `Pubkey::default()`
- Resets `sanctions_max_staleness_slots` to `0`
- Clears `FLAG_SANCTIONS_ORACLE`
- Emits `SanctionsOracleCleared { mint }`

### `update_sanctions_record(wallet, is_sanctioned)`

Creates or updates a wallet's `SanctionsRecord`.

- **Signer:** `oracle` (must match `config.sanctions_oracle`)
- Requires `FLAG_SANCTIONS_ORACLE` to be set
- Sets `record.is_sanctioned` and `record.updated_slot = Clock::get().slot`
- Emits `SanctionsRecordUpdated { mint, wallet, is_sanctioned, slot }`
- Oracle pays rent for new PDAs

### `close_sanctions_record(wallet)`

Closes a `SanctionsRecord` and reclaims rent.

- **Signer:** `oracle`
- Rent is returned to the oracle signer
- Use to clean up records for wallets that are no longer relevant

---

## Transfer Hook Enforcement

The transfer hook performs sanctions checks on every transfer when `FLAG_SANCTIONS_ORACLE` is set.

**Logic (`verify_sanctions_if_required`):**

1. If `FLAG_SANCTIONS_ORACLE` not set → pass
2. If `sanctions_oracle == Pubkey::default()` → pass
3. Derive `expected_sr_pda = PDA(["sanctions-record", mint, src_owner])`
4. Require `remaining_accounts[0]` exists and matches `expected_sr_pda` → if absent, reject with `SanctionsRecordMissingBug003` (**fail-closed**, see Security below)
5. If `record.is_sanctioned == false` → pass
6. **Staleness check** (if `max_staleness_slots > 0`): if `current_slot - record.updated_slot > max_staleness_slots` → reject with `SanctionsRecordStale`
7. If record is fresh and sanctioned → reject with `SanctionedAddress`

**Error codes:**

| Error | Meaning |
|---|---|
| `SanctionedAddress` | Transfer rejected; sender is on the sanctions list |
| `SanctionsRecordStale` | Oracle has not refreshed the record within `max_staleness_slots` |
| `SanctionsRecordMissingBug003` | `SanctionsRecord` account not passed in `remaining_accounts` when oracle is active |

---

## Account Layout (Transfer Hook — zero-copy)

The transfer hook reads `StablecoinConfig` via zero-copy byte offsets:

| Field | Offset | Size |
|---|---|---|
| `sanctions_oracle` | 617 | 32 bytes |
| `sanctions_max_staleness_slots` | 649 | 8 bytes |

`SanctionsRecord` layout:

| Field | Offset | Size |
|---|---|---|
| discriminator | 0 | 8 bytes |
| `is_sanctioned` | 8 | 1 byte |
| `updated_slot` | 9 | 8 bytes |
| `bump` | 17 | 1 byte |

---

## Events

| Event | Fields | Trigger |
|---|---|---|
| `SanctionsOracleSet` | `mint`, `oracle`, `max_staleness_slots` | `set_sanctions_oracle` |
| `SanctionsOracleCleared` | `mint` | `clear_sanctions_oracle` |
| `SanctionsRecordUpdated` | `mint`, `wallet`, `is_sanctioned`, `slot` | `update_sanctions_record` |

---

## Integration Guide

### Enabling sanctions screening

```typescript
// Register your compliance oracle
await program.methods
  .setSanctionsOracle(oraclePublicKey, new BN(150)) // 150 slots ≈ ~1 minute staleness window
  .accounts({ authority: wallet.publicKey, config: configPda })
  .signers([wallet])
  .rpc();
```

### Flagging a wallet

```typescript
// Oracle signer flags a wallet
await program.methods
  .updateSanctionsRecord(targetWallet, true)
  .accounts({
    oracle: oracleKeypair.publicKey,
    config: configPda,
    sanctionsRecord: sanctionsRecordPda,
    systemProgram: SystemProgram.programId,
  })
  .signers([oracleKeypair])
  .rpc();
```

### Computing the SanctionsRecord PDA

```typescript
const [sanctionsRecordPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("sanctions-record"), mint.toBuffer(), wallet.toBuffer()],
  SSS_TOKEN_PROGRAM_ID
);
```

### Clearing a flag

```typescript
// Unflag a wallet (e.g., false positive resolved)
await program.methods
  .updateSanctionsRecord(targetWallet, false)
  .accounts({ oracle: oracleKeypair.publicKey, config: configPda, sanctionsRecord, systemProgram })
  .signers([oracleKeypair])
  .rpc();
```

### Disabling the oracle

```typescript
await program.methods
  .clearSanctionsOracle()
  .accounts({ authority: wallet.publicKey, config: configPda })
  .signers([wallet])
  .rpc();
```

---

## Staleness Window

`max_staleness_slots` determines how long a sanctions record remains valid without a refresh.

| Value | Behaviour |
|---|---|
| `0` | No staleness check — `is_sanctioned` is authoritative forever |
| `> 0` | Record expires after `max_staleness_slots` slots; stale records fail with `SanctionsRecordStale` |

Recommended: set a staleness window aligned with your oracle's update frequency (e.g., 150 slots ≈ 60 seconds at ~400ms/slot). This prevents stale data from indefinitely blocking or unblocking wallets.

---

## Security

### Fail-Closed Enforcement (BUG-035 / Audit C-2, HIGH — fixed `cba65fc`)

Prior to this fix the `SanctionsRecord` account was optional: if a sender did not include it in `remaining_accounts`, the hook treated the wallet as un-flagged and allowed the transfer. A sanctioned wallet could silently bypass screening by omitting the account.

**Fix:** The hook now derives `expected_sr_pda` first, then requires the account be present via `.ok_or_else(HookError::SanctionsRecordMissingBug003)`. Any transfer that omits the `SanctionsRecord` when `FLAG_SANCTIONS_ORACLE` is active is **rejected**.

**Client impact:** All transfer callers must include the sender's `SanctionsRecord` PDA in `remaining_accounts[0]` whenever `FLAG_SANCTIONS_ORACLE` is set. The PDA address is deterministic — see _Computing the SanctionsRecord PDA_ above.

---

## Tests

20 anchor tests in `tests/sss-128-sanctions-oracle.ts` covering:

- `FLAG_SANCTIONS_ORACLE` is bit 9 (512)
- Authority can set/clear oracle; non-authority cannot
- Oracle can create/update/close `SanctionsRecord`; non-oracle cannot
- `updated_slot` is set to current slot on update
- PDA seeds are `["sanctions-record", mint, wallet]`
- `max_staleness_slots` stored correctly (0 and non-zero)
- `is_sanctioned` can flip true → false
- Two wallets get independent PDAs
- **BUG-035 (10 tests, `bug-035-036-transfer-hook-sanctions-zk-owner.ts`):** omitting `SanctionsRecord` in `remaining_accounts` rejects with `SanctionsRecordMissingBug003` (fail-closed)

---

## Related

- [MICA-COMPLIANCE.md](MICA-COMPLIANCE.md) — MiCA regulatory compliance overview
- [TRAVEL-RULE.md](TRAVEL-RULE.md) — FATF Travel Rule compliance
- [GUARDIAN-PAUSE.md](GUARDIAN-PAUSE.md) — Emergency pause mechanism
