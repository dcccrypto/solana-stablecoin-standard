# SSS — On-Chain SDK: AdminTimelockModule

> **Module:** `AdminTimelockModule` (`sdk/src/AdminTimelockModule.ts`)
> **Added:** SSS-086 (SDK); SSS-085 (on-chain program, Fix 2)

---

## Overview

`AdminTimelockModule` wraps the four on-chain instructions that protect critical single-authority admin operations behind a mandatory **slot-based delay** (default ≈ 2 days). This prevents a compromised admin key from instantly draining or reconfiguring the protocol.

| Method | Description |
|---|---|
| [`proposeTimelockOp()`](#proposetimelockop) | Queue an admin operation (authority transfer or feature-flag change) |
| [`executeTimelockOp()`](#executetimelockop) | Execute the queued op once the delay has elapsed |
| [`cancelTimelockOp()`](#canceltimelockop) | Cancel a pending op before it executes |
| [`setPythFeed()`](#setpythfeed) | Register the canonical Pyth price feed (SSS-085 Fix 1) |
| [`decodePendingOp()`](#decodependingop) | Decode a pending op from a fetched config account |

See [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) for non-timelocked admin operations.
See [on-chain-sdk-cdp.md](./on-chain-sdk-cdp.md) for how `setPythFeed` affects borrowing and liquidation.

---

## Background: Why a Timelock?

SSS audit finding **FINDING-011** identified that a single admin key could immediately transfer protocol authority or toggle feature flags, creating a rug-pull / key-compromise risk. SSS-085 introduced an on-chain timelock that requires any such operation to:

1. Be **proposed** by the current authority (stores op + mature slot on `StablecoinConfig`).
2. Wait at least `config.admin_timelock_delay` slots (~2 days at default).
3. Be **executed** by the same authority only after the slot clock passes `mature_slot`.

The authority can **cancel** the op at any time before execution, providing an escape hatch if the proposal was made in error.

---

## Import

```typescript
import {
  AdminTimelockModule,
  ADMIN_OP_NONE,
  ADMIN_OP_TRANSFER_AUTHORITY,
  ADMIN_OP_SET_FEATURE_FLAG,
  ADMIN_OP_CLEAR_FEATURE_FLAG,
  DEFAULT_ADMIN_TIMELOCK_DELAY,
} from '@stbr/sss-token';
```

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `ADMIN_OP_NONE` | `0` | No pending operation |
| `ADMIN_OP_TRANSFER_AUTHORITY` | `1` | Pending authority transfer |
| `ADMIN_OP_SET_FEATURE_FLAG` | `2` | Pending feature-flag enable |
| `ADMIN_OP_CLEAR_FEATURE_FLAG` | `3` | Pending feature-flag disable |
| `DEFAULT_ADMIN_TIMELOCK_DELAY` | `432_000n` slots | ≈ 2 Solana epochs ≈ 2 days |

---

## Constructor

```typescript
new AdminTimelockModule(
  provider: AnchorProvider,
  program:  Program,          // Anchor Program for the SSS-token IDL
)
```

Obtain the `program` from your `SolanaStablecoin` or `CdpModule` instance, or construct it directly from the IDL:

```typescript
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { AdminTimelockModule } from '@stbr/sss-token';
import idl from '@stbr/sss-token/idl.json';

const program   = new Program(idl, provider);
const timelock  = new AdminTimelockModule(provider, program);
```

---

## Methods

### `proposeTimelockOp()`

```typescript
async proposeTimelockOp(params: ProposeTimelockOpParams): Promise<TransactionSignature>
```

Propose a timelocked admin operation. Only one operation may be pending at a time; calling this again overwrites the previous proposal.

**Authority required:** current admin authority.

#### `ProposeTimelockOpParams`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The stablecoin mint |
| `opKind` | `AdminOpKind` | `ADMIN_OP_TRANSFER_AUTHORITY`, `ADMIN_OP_SET_FEATURE_FLAG`, or `ADMIN_OP_CLEAR_FEATURE_FLAG` |
| `param` | `bigint` | Flag bits for flag ops; `0n` for authority transfer |
| `target` | `PublicKey` | New authority for `ADMIN_OP_TRANSFER_AUTHORITY`; `PublicKey.default` for flag ops |

**Returns:** `Promise<TransactionSignature>`

**Throws:**
- If `opKind` is not one of the three valid operation kinds.

**Example — propose an authority transfer:**

```typescript
const sig = await timelock.proposeTimelockOp({
  mint,
  opKind:  ADMIN_OP_TRANSFER_AUTHORITY,
  param:   0n,
  target:  newAuthorityPublicKey,
});
console.log('Transfer proposed, matures in ~2 days:', sig);
```

**Example — propose enabling a feature flag:**

```typescript
const FEATURE_MINT_CAP = 0x01n; // matches your on-chain constant

const sig = await timelock.proposeTimelockOp({
  mint,
  opKind: ADMIN_OP_SET_FEATURE_FLAG,
  param:  FEATURE_MINT_CAP,
  target: PublicKey.default,
});
```

---

### `executeTimelockOp()`

```typescript
async executeTimelockOp(params: TimelockOpMintParams): Promise<TransactionSignature>
```

Execute the pending timelocked operation. The on-chain clock must be at or past `config.admin_op_mature_slot`.

**Authority required:** current admin authority.

#### `TimelockOpMintParams`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The stablecoin mint |

**Throws:**
- `TimelockNotMature` — the delay has not elapsed yet.
- `NoTimelockPending` — no operation is currently pending.

**Example:**

```typescript
// Check if the op has matured before submitting
const config = await program.account.stablecoinConfig.fetch(configPda);
const pending = timelock.decodePendingOp(config);
const slot    = await connection.getSlot('confirmed');

if (BigInt(slot) >= pending.matureSlot) {
  const sig = await timelock.executeTimelockOp({ mint });
  console.log('Op executed:', sig);
} else {
  const slotsLeft = pending.matureSlot - BigInt(slot);
  console.log(`Not ready. ~${Number(slotsLeft / 400n)} seconds remaining`);
}
```

---

### `cancelTimelockOp()`

```typescript
async cancelTimelockOp(params: TimelockOpMintParams): Promise<TransactionSignature>
```

Cancel the pending timelocked operation. Safe to call at any time before execution.

**Authority required:** current admin authority.

**Throws:**
- `NoTimelockPending` — no operation is currently pending.

**Example:**

```typescript
const sig = await timelock.cancelTimelockOp({ mint });
console.log('Pending op cancelled:', sig);
```

---

### `setPythFeed()`

```typescript
async setPythFeed(params: SetPythFeedParams): Promise<TransactionSignature>
```

Register the canonical Pyth price feed for the stablecoin's CDP module (SSS-085 Fix 1 — FINDING-006 mitigation). After calling this, both `cdp_borrow_stable` and `cdp_liquidate` will reject any price-feed account that does not exactly match the stored pubkey, blocking price-feed substitution attacks.

**Authority required:** current admin authority (not timelocked — immediate effect).

#### `SetPythFeedParams`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The stablecoin mint |
| `feed` | `PublicKey` | The canonical Pyth price feed pubkey |

> **Note:** `setPythFeed` is an immediate instruction (not timelocked). However, it is included in `AdminTimelockModule` because it is an admin-only operation added as part of the SSS-085 security fixes.

**Example:**

```typescript
const SOL_USD_PYTH = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

const sig = await timelock.setPythFeed({
  mint,
  feed: SOL_USD_PYTH,
});
console.log('Pyth feed registered:', sig);
```

---

### `decodePendingOp()`

```typescript
decodePendingOp(config: any): PendingTimelockOp
```

Synchronous helper that decodes a pending operation from an already-fetched `StablecoinConfig` account. Does **not** make a network call.

#### `PendingTimelockOp`

| Field | Type | Description |
|---|---|---|
| `opKind` | `AdminOpKind` | Discriminant — what kind of op is pending |
| `param` | `bigint` | Flag bits, or `0n` for authority transfer |
| `target` | `PublicKey` | New authority, or default pubkey for flag ops |
| `matureSlot` | `bigint` | Slot at which the op becomes executable |
| `isPending` | `boolean` | `true` if `opKind !== ADMIN_OP_NONE` |

**Example:**

```typescript
const configPda = // derive from mint + program seeds
const config    = await program.account.stablecoinConfig.fetch(configPda);
const pending   = timelock.decodePendingOp(config);

if (pending.isPending) {
  console.log('Op kind:     ', pending.opKind);
  console.log('Matures slot:', pending.matureSlot);
  console.log('Target:      ', pending.target.toBase58());
} else {
  console.log('No pending timelock operation');
}
```

---

## Full Lifecycle Example

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import {
  AdminTimelockModule,
  ADMIN_OP_TRANSFER_AUTHORITY,
} from '@stbr/sss-token';
import idl from '@stbr/sss-token/idl.json';

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const provider   = new AnchorProvider(connection, new Wallet(adminKeypair), {});
const program    = new Program(idl, provider);
const timelock   = new AdminTimelockModule(provider, program);

const mint           = new PublicKey('STBL...');
const newAuthority   = new PublicKey('NEW_...');

// Step 1: Propose (slots to mature logged for monitoring)
await timelock.proposeTimelockOp({
  mint,
  opKind: ADMIN_OP_TRANSFER_AUTHORITY,
  param:  0n,
  target: newAuthority,
});

// Step 2: Poll until mature (production: use a cron job)
async function waitAndExecute() {
  const config  = await program.account.stablecoinConfig.fetch(configPda);
  const pending = timelock.decodePendingOp(config);
  const slot    = BigInt(await connection.getSlot('confirmed'));

  if (slot >= pending.matureSlot) {
    await timelock.executeTimelockOp({ mint });
    console.log('Authority transferred to', newAuthority.toBase58());
  } else {
    const slotsLeft = pending.matureSlot - slot;
    console.log(`Waiting ~${Number(slotsLeft / 400n)}s more…`);
    setTimeout(waitAndExecute, 60_000);
  }
}

waitAndExecute();
```

---

## Error Reference

| Error | Cause |
|---|---|
| `TimelockNotMature` | `executeTimelockOp` called before `mature_slot` reached |
| `NoTimelockPending` | `executeTimelockOp` or `cancelTimelockOp` with no pending op |
| `Unauthorized` | Caller is not the current admin authority |

---

## Security Notes

- **One op at a time.** Proposing a new op overwrites any existing pending op. Verify on-chain state before proposing if you need to preserve a pending op.
- **`setPythFeed` is immediate.** Unlike the three timelocked ops, `setPythFeed` takes effect the moment the transaction lands. Set this at protocol initialisation and monitor for unexpected changes.
- **Delay is configurable.** `config.admin_timelock_delay` can be changed via protocol governance. The default is `DEFAULT_ADMIN_TIMELOCK_DELAY` (432 000 slots ≈ 2 days).
- **Key rotation fallback.** If the admin key is lost before a pending authority transfer executes, the protocol is locked. Maintain a secure backup key and test the rotation flow on devnet before mainnet.
