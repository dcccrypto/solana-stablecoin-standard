# On-Chain SDK — RedemptionQueueModule

> **Introduced:** PR #336 — `fix/sdk-anchor-audit-fixes` (merged 2026-03-31)
> **References:** SSS-154 (FIFO front-run-protected redemption queue)

---

## Overview

`RedemptionQueueModule` implements a FIFO redemption queue that eliminates
front-running by processing redemption requests in submission order.
Keeper bots earn `keeperRewardLamports` per processed entry.

Feature flag: `FLAG_REDEMPTION_QUEUE` = bit 23 (`0x800000`).

| Method | Instruction | Auth |
|---|---|---|
| `initRedemptionQueue` | `init_redemption_queue` | stablecoin authority |
| `enqueueRedemption` | `enqueue_redemption` | any user |
| `processRedemption` | `process_redemption` | any authorized keeper |
| `cancelRedemption` | `cancel_redemption` | original requester |
| `updateRedemptionQueue` | `update_redemption_queue` | stablecoin authority |
| `compactRedemptionHead` | `compact_redemption_head` | any keeper |

---

## Installation

```ts
import { RedemptionQueueModule, FLAG_REDEMPTION_QUEUE } from '@sss/sdk';

const rq = new RedemptionQueueModule(provider, programId);
```

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `FLAG_REDEMPTION_QUEUE` | `1n << 23n` | Feature flag bit enabling the FIFO redemption queue. |

---

## PDA Helpers

### `getConfigPda(mint)` → `[PublicKey, number]`
Seeds: `[b"stablecoin-config", mint]`

### `getRedemptionQueuePda(mint)` → `[PublicKey, number]`
Seeds: `[b"redemption-queue", mint]`

### `getQueueEntryPda(mint, index)` → `[PublicKey, number]`
Seeds: `[b"queue-entry", mint, index (u64 LE)]`

---

## Methods

### `initRedemptionQueue(params)` → `Promise<TransactionSignature>`

Initialise the `RedemptionQueue` PDA.  Requires `FLAG_REDEMPTION_QUEUE` to
be set on `StablecoinConfig`.  Authority-only.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |

---

### `enqueueRedemption(params)` → `Promise<TransactionSignature>`

Submit a redemption request to the back of the queue.  Stable tokens are
transferred to escrow immediately (queue holds custody).

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `amount` | `bigint \| number` | Amount of stable tokens to redeem. |
| `userStableAta` | `PublicKey` | User's stable-token ATA (source). |
| `stableMint` | `PublicKey` | Stable token mint. |
| `tokenProgram` | `PublicKey` | Token program (Token-2022 or legacy). |

```ts
await rq.enqueueRedemption({ mint, amount: 1_000_000n, userStableAta, stableMint, tokenProgram });
```

---

### `processRedemption(params)` → `Promise<TransactionSignature>`

Process the front-of-queue entry.  Any authorized keeper may call this.
Keeper earns `keeperRewardLamports` SOL on success.

**Params** (`ProcessRedemptionParams`)

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `queueIndex` | `bigint` | Index of the entry to process. |
| `userStableAta` | `PublicKey` | User's stable-token ATA. |
| `userCollateralAta` | `PublicKey` | User's collateral ATA (receives collateral). |
| `vaultCollateralAta` | `PublicKey` | Vault collateral ATA (source). |
| `stableMint` | `PublicKey` | Stable token mint. |
| `collateralMint` | `PublicKey` | Collateral mint. |
| `tokenProgram` | `PublicKey` | Token program. |
| `keeperAta` | `PublicKey` | Keeper's ATA or system account for reward. |

---

### `cancelRedemption(params)` → `Promise<TransactionSignature>`

Cancel a queued entry and return escrowed tokens.  Only the original
requester may cancel their own entry.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `queueIndex` | `bigint` | Index of the entry to cancel. |
| `userStableAta` | `PublicKey` | User's stable-token ATA (receives refund). |
| `stableMint` | `PublicKey` | Stable token mint. |
| `tokenProgram` | `PublicKey` | Token program. |

---

### `updateRedemptionQueue(params)` → `Promise<TransactionSignature>`

Update queue parameters.  Authority-only.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `minDelaySlots?` | `bigint` | Minimum slots between enqueue and process. |
| `maxQueueDepth?` | `number` | Maximum concurrent queue entries. |
| `maxRedemptionPerSlotBps?` | `number` | Max redemption per slot as bps of supply. |
| `keeperRewardLamports?` | `bigint` | SOL reward per processed entry. |

---

### `compactRedemptionHead(params)` → `Promise<TransactionSignature>`

Reclaim rent from fully processed/cancelled head entries.  Any keeper can
call this; no reward.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `headIndex` | `bigint` | Index of the head entry to compact. |

---

## Full Example

```ts
import { RedemptionQueueModule } from '@sss/sdk';

const rq = new RedemptionQueueModule(provider, programId);

// User submits redemption
await rq.enqueueRedemption({ mint, amount: 500_000n, userStableAta, stableMint, tokenProgram });

// Keeper processes head entry
await rq.processRedemption({ mint, queueIndex: 0n, userStableAta, userCollateralAta, vaultCollateralAta, stableMint, collateralMint, tokenProgram, keeperAta });

// Compact processed slots
await rq.compactRedemptionHead({ mint, headIndex: 0n });
```

---

## Related

- [REDEMPTION-QUEUE.md](REDEMPTION-QUEUE.md) — FIFO redemption queue design (SSS-154)
- [on-chain-sdk-cdp.md](on-chain-sdk-cdp.md) — CDP module (mint/burn/redeem)
- SSS-154 — FIFO front-run-protected redemption queue
