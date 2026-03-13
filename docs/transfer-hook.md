# SSS — Transfer Hook Program

> **Feature:** SSS-2 (Compliant preset)
> **Program ID:** `8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj`
> **Scope:** On-chain blacklist enforcement via Token-2022 Transfer Hook interface

---

## Overview

SSS-2 stablecoins register the `sss-transfer-hook` program as a Token-2022 **transfer hook**. Token-2022 automatically invokes this program on every token transfer. If either the sender or the receiver is on the blacklist, the transfer is rejected with an on-chain error — no off-chain middleware can bypass it.

```
User calls Transfer → Token-2022 → sss-transfer-hook → checks BlacklistState PDA
                                                           ↳ reject if sender/receiver blacklisted
                                                           ↳ allow otherwise
```

The backend compliance API (see [compliance-audit-log.md](./compliance-audit-log.md)) manages the blacklist at the REST layer, but the on-chain program provides the **enforcement guarantee**.

---

## Account: `BlacklistState`

One `BlacklistState` PDA exists per mint. It is derived from:

```
seeds = [b"blacklist-state", mint_pubkey]
```

| Field          | Type          | Description                                           |
|----------------|---------------|-------------------------------------------------------|
| `mint`         | `Pubkey`      | The Token-2022 mint this blacklist belongs to         |
| `authority`    | `Pubkey`      | Authority that can add/remove addresses               |
| `blacklisted`  | `Vec<Pubkey>` | Up to 100 blacklisted addresses                       |
| `bump`         | `u8`          | PDA bump seed                                         |

Space allocation: `8 + 32 + 32 + 4 + (100 × 32) + 1 = 3277 bytes`

---

## Instructions

### `initialize_extra_account_meta_list`

Initializes the `BlacklistState` PDA for a mint. Must be called once during SSS-2 stablecoin setup, before any transfers occur.

**Accounts**

| Name               | Writable | Signer | Description                                  |
|--------------------|----------|--------|----------------------------------------------|
| `authority`        | ✅       | ✅     | Pays for PDA init; becomes blacklist authority |
| `mint`             | ❌       | ❌     | The Token-2022 mint                           |
| `blacklist_state`  | ✅       | ❌     | PDA to initialize (`seeds = ["blacklist-state", mint]`) |
| `system_program`   | ❌       | ❌     | System program                               |

**Behavior:** Creates the `BlacklistState` with an empty blacklist and sets `authority` to the signer.

---

### `blacklist_add`

Adds a public key to the blacklist. After this call, any transfer to or from this address will be rejected.

**Accounts**

| Name               | Writable | Signer | Description                         |
|--------------------|----------|--------|-------------------------------------|
| `authority`        | ❌       | ✅     | Must match `blacklist_state.authority` |
| `mint`             | ❌       | ❌     | The Token-2022 mint                 |
| `blacklist_state`  | ✅       | ❌     | PDA for this mint                   |

**Parameters**

| Name      | Type     | Description                     |
|-----------|----------|---------------------------------|
| `address` | `Pubkey` | Address to add to the blacklist |

**Notes:**
- No-op if the address is already blacklisted (idempotent).
- Fails with `Unauthorized` if the signer is not the blacklist authority.

---

### `blacklist_remove`

Removes a public key from the blacklist. Transfers to/from this address will be permitted again.

**Accounts**

| Name               | Writable | Signer | Description                         |
|--------------------|----------|--------|-------------------------------------|
| `authority`        | ❌       | ✅     | Must match `blacklist_state.authority` |
| `mint`             | ❌       | ❌     | The Token-2022 mint                 |
| `blacklist_state`  | ✅       | ❌     | PDA for this mint                   |

**Parameters**

| Name      | Type     | Description                          |
|-----------|----------|--------------------------------------|
| `address` | `Pubkey` | Address to remove from the blacklist |

**Notes:**
- No-op if the address is not on the blacklist.

---

### `transfer_hook` _(invoked by Token-2022, not directly)_

This instruction is called automatically by Token-2022 on every transfer for an SSS-2 mint. **Do not call it directly** — it requires the Token-2022 CPI calling convention.

**Behavior:**
1. Loads the `BlacklistState` PDA for the mint.
2. Checks `blacklist_state.is_blacklisted(source_token_account.owner)`.
3. Checks `blacklist_state.is_blacklisted(destination_token_account.owner)`.
4. If either check is true → returns `HookError::SenderBlacklisted` or `HookError::ReceiverBlacklisted`.
5. Otherwise → logs `"Transfer hook: <amount> tokens OK"` and returns `Ok(())`.

---

## Error Codes

| Code                   | Value | Message                   |
|------------------------|-------|---------------------------|
| `SenderBlacklisted`    | 6000  | Sender is blacklisted      |
| `ReceiverBlacklisted`  | 6001  | Receiver is blacklisted    |
| `Unauthorized`         | 6002  | Unauthorized               |

---

## TypeScript: Managing the Blacklist

The `ComplianceModule` in the SDK wraps the blacklist management instructions. For direct Anchor usage:

```typescript
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  '8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj'
);

// Derive BlacklistState PDA
const [blacklistState] = PublicKey.findProgramAddressSync(
  [Buffer.from('blacklist-state'), mint.toBuffer()],
  TRANSFER_HOOK_PROGRAM_ID,
);

// Add to blacklist
await program.methods
  .blacklistAdd(suspectAddress)
  .accounts({
    authority: provider.wallet.publicKey,
    mint,
    blacklistState,
  })
  .rpc();

// Remove from blacklist
await program.methods
  .blacklistRemove(suspectAddress)
  .accounts({
    authority: provider.wallet.publicKey,
    mint,
    blacklistState,
  })
  .rpc();
```

For higher-level SDK usage, prefer the REST compliance API described in [compliance-audit-log.md](./compliance-audit-log.md), which wraps these calls and appends an audit log entry atomically.

---

## Deployment & Registration

The transfer hook program must be deployed before initializing an SSS-2 stablecoin. On devnet it is pre-deployed at the program ID above. See [devnet-deploy.md](./devnet-deploy.md) for the full deployment flow.

When `SolanaStablecoin.create()` is called with `sss2Config(...)`, the SDK automatically:
1. Passes `transfer_hook_program: TRANSFER_HOOK_PROGRAM_ID` to the `initialize` instruction.
2. Calls `initialize_extra_account_meta_list` to create the `BlacklistState` PDA.

Token-2022 records the hook program in the mint's extension data, ensuring the hook is invoked on every subsequent transfer.

---

## Capacity & Upgrade Path

The current `BlacklistState` allocates space for **100 blacklisted addresses**. Exceeding this limit will cause the `blacklist_add` instruction to fail with an account space error.

For production deployments expecting larger blacklists, either:
- Reallocate the PDA using `anchor_lang::system_program::transfer` + `AccountInfo::realloc`, or
- Migrate to a paginated blacklist design (planned for a future SSS version).
