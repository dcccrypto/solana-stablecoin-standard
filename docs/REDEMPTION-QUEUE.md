# Redemption Queue

_Author: sss-docs | Task: SSS-154 | Date: 2026-03-26_

The Redemption Queue provides a **FIFO, slot-delayed, front-run-protected** mechanism for stablecoin holders to redeem tokens for collateral. It replaces atomic, per-instruction redemption with an ordered queue that enforces a minimum delay between enqueue and processing — eliminating MEV front-running and enabling per-slot throughput caps.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Feature Flag](#2-feature-flag)
3. [On-Chain State](#3-on-chain-state)
4. [Instructions](#4-instructions)
   - [init_redemption_queue](#41-init_redemption_queue)
   - [enqueue_redemption](#42-enqueue_redemption)
   - [process_redemption](#43-process_redemption)
   - [cancel_redemption](#44-cancel_redemption)
   - [update_redemption_queue](#45-update_redemption_queue)
5. [Events](#5-events)
6. [Error Reference](#6-error-reference)
7. [Default Parameters](#7-default-parameters)
8. [TypeScript Example](#8-typescript-example)
9. [Keeper Runbook](#9-keeper-runbook)
10. [Security Notes](#10-security-notes)

---

## 1. Overview

Standard on-chain redemption is vulnerable to MEV: bots monitor the mempool and front-run redemption instructions to extract value before the legitimate user's transaction lands. The Redemption Queue mitigates this in three ways:

1. **Minimum slot delay** — a redemption cannot be processed until at least `min_delay_slots` slots after enqueue, making front-running economically unattractive.
2. **Slot hash seed** — the SlotHashes sysvar value at enqueue time is recorded in each entry, adding unpredictability to the ordering.
3. **Per-slot cap** — `max_redemption_per_slot_bps` limits the fraction of total supply redeemable in any single slot, preventing run-on-the-bank scenarios.

Tokens are escrowed in a per-entry PDA at enqueue time. On processing, the escrow is burned and collateral is released 1:1 from the reserve vault. Users may cancel at any time before processing to recover their escrowed tokens.

---

## 2. Feature Flag

| Flag | Bit | Hex |
|------|-----|-----|
| `FLAG_REDEMPTION_QUEUE` | 23 | `0x800000` |

Set via `update_feature_flags`. Required for `init_redemption_queue`, `enqueue_redemption`, and `process_redemption`.

---

## 3. On-Chain State

### `RedemptionQueue` PDA

Seeds: `["redemption_queue", sss_mint]`

| Field | Type | Description |
|-------|------|-------------|
| `bump` | `u8` | PDA bump |
| `sss_mint` | `Pubkey` | Stablecoin mint |
| `queue_head` | `u64` | Index of oldest unfulfilled entry (inclusive) |
| `queue_tail` | `u64` | Index of next entry to be created (exclusive) |
| `min_delay_slots` | `u64` | Minimum slots between enqueue and process |
| `max_queue_depth` | `u64` | Maximum simultaneous pending entries |
| `max_redemption_per_slot_bps` | `u16` | Per-slot cap as fraction of total supply (basis points) |
| `last_slot_processed` | `u64` | Slot at which `slot_redemption_total` was last reset |
| `slot_redemption_total` | `u64` | Running total of tokens redeemed in `last_slot_processed` |
| `keeper_reward_lamports` | `u64` | Lamport reward paid to keeper per fulfilled entry |

### `RedemptionEntry` PDA

Seeds: `["redemption_entry", sss_mint, queue_index_le_bytes]`

| Field | Type | Description |
|-------|------|-------------|
| `bump` | `u8` | PDA bump |
| `queue_index` | `u64` | Position in the global queue |
| `owner` | `Pubkey` | Wallet that submitted this redemption |
| `amount` | `u64` | Stablecoin base units to redeem |
| `enqueue_slot` | `u64` | Slot at which this entry was created |
| `slot_hash_seed` | `[u8; 8]` | First 8 bytes of SlotHashes hash at enqueue time |
| `fulfilled` | `bool` | True after `process_redemption` succeeds |
| `cancelled` | `bool` | True after `cancel_redemption` is called |

### Escrow Token Account (per entry)

Seeds: `["queue-escrow", sss_mint, queue_index_le_bytes]`
Authority: `RedemptionQueue` PDA. Holds escrowed stable tokens until burned or returned.

---

## 4. Instructions

### 4.1 `init_redemption_queue`

Initialises the `RedemptionQueue` PDA for a mint. Must be called by the stablecoin `authority` after enabling `FLAG_REDEMPTION_QUEUE`.

**Accounts:**

| Account | Mutability | Description |
|---------|-----------|-------------|
| `authority` | signer, mut | Stablecoin authority |
| `config` | read | `StablecoinConfig` PDA; must have `FLAG_REDEMPTION_QUEUE` set |
| `redemption_queue` | init, mut | New `RedemptionQueue` PDA |
| `system_program` | — | — |

**Constraints:** `config.authority == authority`, `FLAG_REDEMPTION_QUEUE` must be set.

Initialises all fields to defaults (see [§7](#7-default-parameters)).

---

### 4.2 `enqueue_redemption`

Enqueues a redemption request. Transfers `amount` stable tokens from the user to a per-entry escrow.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `amount` | `u64` | Number of stablecoin base units to redeem |

**Accounts:**

| Account | Mutability | Description |
|---------|-----------|-------------|
| `user` | signer, mut | Redemption submitter |
| `config` | read | `StablecoinConfig` PDA |
| `redemption_queue` | mut | `RedemptionQueue` PDA |
| `user_stable_ata` | mut | User's stablecoin token account (source) |
| `escrow_stable` | init, mut | Per-entry escrow (seeds: `queue-escrow`, mint, index) |
| `redemption_entry` | init, mut | Per-entry state PDA |
| `slot_hashes` | read | `SlotHashes` sysvar |
| `stable_mint` | read | Stablecoin mint |
| `token_program` | — | — |
| `system_program` | — | — |

**Emits:** `RedemptionQueued`

**Errors:** `RedemptionQueueFull` if `queue_depth >= max_queue_depth`; `InvalidAmount` if `amount == 0`.

---

### 4.3 `process_redemption`

Fulfils a queued entry. Burns the escrowed stable tokens and transfers collateral 1:1 from the reserve vault to the user. Pays a lamport reward to the keeper.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `queue_index` | `u64` | Index of the entry to process |

**Accounts:**

| Account | Mutability | Description |
|---------|-----------|-------------|
| `keeper` | signer, mut | Keeper receiving the lamport reward |
| `config` | mut | `StablecoinConfig` PDA |
| `redemption_queue` | mut | `RedemptionQueue` PDA |
| `redemption_entry` | mut | Entry to process |
| `escrow_stable` | mut | Per-entry escrow (burned) |
| `reserve_vault` | mut | Reserve collateral vault (source) |
| `reserve_vault_authority` | signer | Authority over the reserve vault |
| `user_collateral_ata` | mut | User's collateral ATA (destination) |
| `stable_mint` | mut | Stablecoin mint (supply decremented on burn) |
| `collateral_mint` | read | Collateral mint |
| `token_program` | — | — |
| `system_program` | — | — |

**Guards:**
- `current_slot >= enqueue_slot + min_delay_slots` → `RedemptionNotReady`
- Per-slot cap: `slot_redemption_total + amount <= (supply * max_redemption_per_slot_bps / 10_000).max(1)` → `RedemptionSlotCapExceeded`
- Entry not already fulfilled/cancelled → `RedemptionAlreadyProcessed`

**Side effects:** advances `queue_head` if the entry is at head; increments `config.total_burned`; pays keeper reward from queue PDA lamports (surplus above rent-exempt minimum only).

**Emits:** `RedemptionFulfilledQueued`

---

### 4.4 `cancel_redemption`

Cancels a pending entry and returns escrowed tokens to the user.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `queue_index` | `u64` | Index of the entry to cancel |

**Accounts:**

| Account | Mutability | Description |
|---------|-----------|-------------|
| `owner` | signer, mut | Original submitter |
| `config` | read | `StablecoinConfig` PDA |
| `redemption_queue` | mut | `RedemptionQueue` PDA |
| `redemption_entry` | mut | Entry to cancel |
| `escrow_stable` | mut | Per-entry escrow (tokens returned) |
| `user_stable_ata` | mut | User's stablecoin ATA (destination) |
| `stable_mint` | read | Stablecoin mint |
| `token_program` | — | — |

**Constraints:** `owner == entry.owner` → `RedemptionNotOwner`; entry not yet fulfilled/cancelled → `RedemptionAlreadyProcessed`.

**Emits:** `RedemptionCancelled`

---

### 4.5 `update_redemption_queue`

Authority-only instruction to adjust queue parameters.

**Parameters (all optional):**

| Param | Type | Description |
|-------|------|-------------|
| `min_delay_slots` | `Option<u64>` | New minimum slot delay |
| `max_queue_depth` | `Option<u64>` | New maximum pending entries (must be > 0) |
| `max_redemption_per_slot_bps` | `Option<u16>` | New per-slot cap in basis points (≤ 10_000) |
| `keeper_reward_lamports` | `Option<u64>` | New keeper reward per entry |

**Accounts:** `authority` (signer), `config`, `redemption_queue`.

---

## 5. Events

### `RedemptionQueued`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | Stablecoin mint |
| `owner` | `Pubkey` | Submitter |
| `queue_index` | `u64` | Entry index |
| `amount` | `u64` | Tokens queued |
| `enqueue_slot` | `u64` | Slot at enqueue |
| `slot_hash_seed` | `[u8; 8]` | SlotHashes seed |
| `earliest_process_slot` | `u64` | `enqueue_slot + min_delay_slots` |

### `RedemptionFulfilledQueued`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | Stablecoin mint |
| `owner` | `Pubkey` | Original submitter |
| `queue_index` | `u64` | Entry index |
| `amount` | `u64` | Tokens burned |
| `enqueue_slot` | `u64` | Slot at enqueue |
| `fulfilled_slot` | `u64` | Slot at processing |
| `keeper` | `Pubkey` | Keeper that processed |
| `keeper_reward_lamports` | `u64` | Lamports paid to keeper |

### `RedemptionCancelled`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | Stablecoin mint |
| `owner` | `Pubkey` | Entry owner |
| `queue_index` | `u64` | Entry index |
| `amount` | `u64` | Tokens returned |
| `cancel_slot` | `u64` | Slot at cancellation |

---

## 6. Error Reference

| Error | Code | Meaning |
|-------|------|---------|
| `RedemptionQueueFull` | — | `queue_depth >= max_queue_depth`; wait for entries to be processed or cancelled |
| `RedemptionNotReady` | — | `min_delay_slots` have not elapsed since enqueue |
| `RedemptionAlreadyProcessed` | — | Entry has already been fulfilled or cancelled |
| `RedemptionSlotCapExceeded` | — | Per-slot cap exceeded; retry in a later slot |
| `RedemptionNotOwner` | — | Only the entry `owner` may cancel |
| `RedemptionQueueNotInitialized` | — | `init_redemption_queue` has not been called |

---

## 7. Default Parameters

| Parameter | Default | Notes |
|-----------|---------|-------|
| `min_delay_slots` | `50` | ~20 seconds at 400ms/slot |
| `max_queue_depth` | `100` | Concurrent pending entries |
| `max_redemption_per_slot_bps` | `500` | 5% of total supply per slot |
| `keeper_reward_lamports` | `5_000` | ~0.000005 SOL per processed entry |

---

## 8. TypeScript Example

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// --- Derive PDAs ---
const [redemptionQueuePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("redemption_queue"), sstMint.toBuffer()],
  program.programId
);

const queueAccount = await program.account.redemptionQueue.fetch(redemptionQueuePda);
const queueTail = queueAccount.queueTail.toNumber();

const [redemptionEntryPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("redemption_entry"),
    sstMint.toBuffer(),
    Buffer.from(new anchor.BN(queueTail).toArrayLike(Buffer, "le", 8)),
  ],
  program.programId
);

const [escrowPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("queue-escrow"),
    sstMint.toBuffer(),
    Buffer.from(new anchor.BN(queueTail).toArrayLike(Buffer, "le", 8)),
  ],
  program.programId
);

// --- Enqueue ---
const amount = new anchor.BN(1_000_000); // 1 SST (6 decimals)
await program.methods
  .enqueueRedemption(amount)
  .accounts({
    user: wallet.publicKey,
    config: configPda,
    redemptionQueue: redemptionQueuePda,
    userStableAta: userStableAta,
    escrowStable: escrowPda,
    redemptionEntry: redemptionEntryPda,
    slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
    stableMint: sstMint,
  })
  .rpc();

console.log(`Enqueued at index ${queueTail}. Earliest process slot: ${queueTail + 50}`);

// --- Process (keeper) ---
await program.methods
  .processRedemption(new anchor.BN(queueTail))
  .accounts({
    keeper: keeperWallet.publicKey,
    config: configPda,
    redemptionQueue: redemptionQueuePda,
    redemptionEntry: redemptionEntryPda,
    escrowStable: escrowPda,
    reserveVault: reserveVaultAta,
    reserveVaultAuthority: reserveAuthority.publicKey,
    userCollateralAta: userUsdcAta,
    stableMint: sstMint,
    collateralMint: usdcMint,
  })
  .rpc();

// --- Cancel ---
await program.methods
  .cancelRedemption(new anchor.BN(queueTail))
  .accounts({
    owner: wallet.publicKey,
    config: configPda,
    redemptionQueue: redemptionQueuePda,
    redemptionEntry: redemptionEntryPda,
    escrowStable: escrowPda,
    userStableAta: userStableAta,
    stableMint: sstMint,
  })
  .rpc();
```

---

## 9. Keeper Runbook

Keepers poll `RedemptionQueued` events and call `process_redemption` when entries become ready.

```typescript
async function runRedemptionKeeper(program: Program, mint: PublicKey) {
  const [queuePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("redemption_queue"), mint.toBuffer()],
    program.programId
  );

  while (true) {
    const queue = await program.account.redemptionQueue.fetch(queuePda);
    const slot = await program.provider.connection.getSlot();

    for (let i = queue.queueHead.toNumber(); i < queue.queueTail.toNumber(); i++) {
      const [entryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("redemption_entry"), mint.toBuffer(),
         Buffer.from(new BN(i).toArrayLike(Buffer, "le", 8))],
        program.programId
      );
      const entry = await program.account.redemptionEntry.fetch(entryPda);
      if (entry.fulfilled || entry.cancelled) continue;

      const readySlot = entry.enqueueSlot.toNumber() + queue.minDelaySlots.toNumber();
      if (slot < readySlot) continue;

      try {
        await program.methods.processRedemption(new BN(i)).accounts({ /* ... */ }).rpc();
        console.log(`Processed index ${i}, earned ${queue.keeperRewardLamports} lamports`);
      } catch (e) {
        console.warn(`process_redemption[${i}] failed: ${e}`);
      }
    }

    await sleep(2000); // poll every 2 seconds (~5 slots)
  }
}
```

**Operational notes:**
- Entries are FIFO but keepers may process out of order; only head advancement is strictly ordered.
- If `slot_cap` is hit, retry in the next slot.
- Keeper reward is paid from queue PDA lamports. Top up the queue account to sustain rewards; reward is capped to available surplus above rent-exempt minimum.
- Monitor for stale entries (unfulfilled for > 500 slots) — these may indicate a reserve vault authorization issue.

---

## 10. Security Notes

**Front-run protection:** The `slot_hash_seed` field records the first 8 bytes of the latest SlotHashes entry at enqueue time. Combined with `min_delay_slots`, this makes the ordering and timing of redemptions unpredictable, raising the cost of MEV extraction above typical profit margins.

**Per-slot cap:** `max_redemption_per_slot_bps` limits redemption throughput to prevent bank-run scenarios. The cap always allows at least 1 base unit per slot to avoid a deadlock where no entry can ever be processed.

**Escrow isolation:** Each entry has its own escrow PDA. A failure in one entry's processing does not affect others.

**Keeper reward trust:** The keeper reward is paid from the queue PDA's surplus lamports. The queue never goes below rent-exempt minimum — rewards are capped to available surplus. Fund the queue account externally to sustain keeper incentives.

**No bypass:** `FLAG_REDEMPTION_QUEUE` must be active for `enqueue_redemption` and `process_redemption`. Disabling the flag mid-operation does not affect existing entries (their `RedemptionEntry` PDAs remain valid), but new enqueue/process calls will fail. Cancel remains callable regardless of feature flag state.
