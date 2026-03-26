# SSS — On-Chain SDK: AdminTimelockModule

> **Module:** `AdminTimelockModule` (`sdk/src/AdminTimelockModule.ts`)
> **Added:** SSS-086 (SDK); SSS-085 (on-chain program, Fix 2)

---

## Overview

`AdminTimelockModule` wraps the four on-chain instructions that protect critical single-authority admin operations behind a mandatory **slot-based delay** (default ≈ 2 days). This prevents a compromised admin key from instantly draining or reconfiguring the protocol.

| Method | Description |
|---|---|
| [`proposeTimelockOp()`](#proposetimelockop) | Queue an admin operation (authority transfer, feature-flag change, Pyth feed, or oracle params) |
| [`executeTimelockOp()`](#executetimelockop) | Execute the queued op once the delay has elapsed |
| [`cancelTimelockOp()`](#canceltimelockop) | Cancel a pending op before it executes |
| [`setPythFeed()`](#setpythfeed) | Register the canonical Pyth price feed via timelock (ADMIN_OP_SET_PYTH_FEED) |
| [`setOracleParams()`](#setoracleparams) | Set oracle staleness / confidence params via timelock (ADMIN_OP_SET_ORACLE_PARAMS) |
| [`decodePendingOp()`](#decodependingop) | Decode a pending op from a fetched config account |

See [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) for non-timelocked admin operations.
See [on-chain-sdk-cdp.md](./on-chain-sdk-cdp.md) for how `setPythFeed` affects borrowing and liquidation.
See [on-chain-sdk-oracle-params.md](./on-chain-sdk-oracle-params.md) for the full oracle-params reference.

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
  ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY,
  DEFAULT_ADMIN_TIMELOCK_DELAY,
} from '@stbr/sss-token';
```

---

## Constants

> **BUG-010 (AUDIT-A CRIT-04/HIGH-06/07):** Previously only 3 operations were timelocked (authority transfer, set/clear feature flag). As of this fix, all ~17 privileged admin operations require the propose → wait → execute flow when `admin_timelock_delay > 0`. The only exception is `register_collateral` / `update_collateral_config` when executed via Squads multisig — Squads itself provides multi-party timelock controls.

| Constant | Value | Description |
|---|---|---|
| `ADMIN_OP_NONE` | `0` | No pending operation |
| `ADMIN_OP_TRANSFER_AUTHORITY` | `1` | Pending admin authority transfer |
| `ADMIN_OP_SET_FEATURE_FLAG` | `2` | Pending feature-flag enable |
| `ADMIN_OP_CLEAR_FEATURE_FLAG` | `3` | Pending feature-flag disable |
| `ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` | `10` | Pending compliance authority transfer — **always enforces min 432 000-slot delay (BUG-019)** |
| `DEFAULT_ADMIN_TIMELOCK_DELAY` | `432_000n` slots | ≈ 2 Solana epochs ≈ 2 days |

> **Note on compliance authority transfer:** When `admin_timelock_delay > 0`, calling `update_roles` to transfer the compliance authority is blocked on-chain. Use `ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` (op kind `10`) via the propose → execute flow instead.

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
| `opKind` | `AdminOpKind` | `ADMIN_OP_TRANSFER_AUTHORITY` (1), `ADMIN_OP_SET_FEATURE_FLAG` (2), `ADMIN_OP_CLEAR_FEATURE_FLAG` (3), or `ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` (10) |
| `param` | `bigint` | Flag bits for flag ops; `0n` for authority/compliance transfers |
| `target` | `PublicKey` | New authority for `ADMIN_OP_TRANSFER_AUTHORITY` or `ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY`; `PublicKey.default` for flag ops |

**Returns:** `Promise<TransactionSignature>`

**Throws:**
- `SSSError` if `opKind` is `ADMIN_OP_NONE` (0) — passing a no-op kind locks out all admin operations for the full timelock delay (~2 days) without effect. See [AUDIT-F2 fix](#security-notes) and [audit finding](#audit-findings).
- If `opKind` is not one of the four valid operation kinds.

> **BUG-019 — Compliance authority minimum delay:** When `opKind = ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` (10), the on-chain program uses `max(admin_timelock_delay, DEFAULT_ADMIN_TIMELOCK_DELAY)` as the effective delay. Even if `admin_timelock_delay` has been reduced to zero, this op always enforces the full 432 000-slot (~48 h) wait. This prevents a compromised authority from lowering the delay then immediately hijacking the compliance authority in two transactions.

**Example — propose an admin authority transfer:**

```typescript
const sig = await timelock.proposeTimelockOp({
  mint,
  opKind:  ADMIN_OP_TRANSFER_AUTHORITY,
  param:   0n,
  target:  newAuthorityPublicKey,
});
console.log('Transfer proposed, matures in ~2 days:', sig);
```

**Example — propose a compliance authority transfer (BUG-019: min 432 000-slot delay):**

```typescript
import { ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY } from '@stbr/sss-token';

const sig = await timelock.proposeTimelockOp({
  mint,
  opKind:  ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY,
  param:   0n,
  target:  newCompliancePublicKey,
});
// On-chain delay = max(config.admin_timelock_delay, 432_000) slots
console.log('Compliance transfer proposed, matures in ≥432 000 slots (~48 h):', sig);

// After the delay, execute then accept:
await timelock.executeTimelockOp({ mint });
const stablecoinAsNewCompliance = await SolanaStablecoin.load(newComplianceProvider, mint);
await stablecoinAsNewCompliance.acceptComplianceAuthority();
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

Convenience wrapper that proposes a `ADMIN_OP_SET_PYTH_FEED` (op_kind=4) timelocked operation to register the canonical Pyth price feed for the stablecoin's CDP module (SSS-085 Fix 1 — FINDING-006 mitigation, BUG-017 / AUDIT-A HIGH-06). After the proposal matures and is executed, both `cdp_borrow_stable` and `cdp_liquidate` will reject any price-feed account that does not exactly match the stored pubkey, blocking price-feed substitution attacks.

> **⚠️ BREAKING (BUG-017):** Prior documentation incorrectly described `setPythFeed` as "immediate / not timelocked". The on-chain program **enforces the timelock** for this instruction (direct calls are rejected when `admin_timelock_delay > 0`). Always use the propose → wait → execute flow. See [AUDIT-A HIGH-06](#audit-a-high-06-oracle-config-not-behind-timelock).

**Authority required:** current admin authority (timelock-protected).

#### `SetPythFeedParams`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The stablecoin mint |
| `feed` | `PublicKey` | The canonical Pyth price feed pubkey |

**Example — full propose → wait → execute flow:**

```typescript
const SOL_USD_PYTH = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

// Step 1: propose
const sig = await timelock.setPythFeed({
  mint,
  feed: SOL_USD_PYTH,
});
console.log('SET_PYTH_FEED proposed, matures in ~2 days:', sig);

// Step 2: wait for mature_slot, then execute
await timelock.executeTimelockOp({ mint });
console.log('Pyth feed registered:', SOL_USD_PYTH.toBase58());
```

---

### `setOracleParams()`

```typescript
async setOracleParams(params: SetOracleParamsTimelockParams): Promise<TransactionSignature>
```

Convenience wrapper that proposes a `ADMIN_OP_SET_ORACLE_PARAMS` (op_kind=5) timelocked operation to update oracle staleness and confidence-interval constraints (BUG-017 / AUDIT-A HIGH-06). After the proposal matures and is executed, `StablecoinConfig.max_oracle_age_secs` and `max_oracle_conf_bps` are updated atomically and take effect for all subsequent CDP borrows and liquidations.

> **⚠️ BREAKING (BUG-017):** Prior documentation in [on-chain-sdk-oracle-params.md](./on-chain-sdk-oracle-params.md) described `set_oracle_params` as authority-only but did not mention timelock enforcement. The on-chain program **requires** the timelock for this instruction when `admin_timelock_delay > 0`. Direct calls are rejected. Always use the propose → wait → execute flow.

**Authority required:** current admin authority (timelock-protected).

#### `SetOracleParamsTimelockParams`

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The stablecoin mint |
| `maxOracleAgeSecs` | `number` | Maximum allowed Pyth price age in seconds (`0` → 60 s on-chain default) |
| `maxOracleConfBps` | `number` | Maximum confidence/price ratio in basis points (`0` → disabled) |

**Example — full propose → wait → execute flow:**

```typescript
// Step 1: propose
const sig = await timelock.setOracleParams({
  mint,
  maxOracleAgeSecs: 60,
  maxOracleConfBps: 100, // 1%
});
console.log('SET_ORACLE_PARAMS proposed, matures in ~2 days:', sig);

// Step 2: wait for mature_slot, then execute
await timelock.executeTimelockOp({ mint });
console.log('Oracle params updated: 60 s / 100 bps');
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
| `TimelockRequired` | Direct handler called for an op kind that requires the timelock propose → execute path (when `admin_timelock_delay > 0`) |
| `InvalidTimelockOpKind` | `proposeTimelockOp` called with an unrecognised `opKind` value |
| `InvalidTimelockDelay` | `ADMIN_OP_SET_TIMELOCK_DELAY` proposed with a value below the minimum (216 000 slots) |
| `InvalidStabilityFee` | `ADMIN_OP_SET_STABILITY_FEE` proposed with an out-of-range fee value |
| `InvalidBackstopParams` | `ADMIN_OP_SET_BACKSTOP_PARAMS` proposed with invalid parameters |
| `InvalidReserveRatio` | `ADMIN_OP_SET_MIN_RESERVE_RATIO` proposed with an invalid ratio |
| `DaoFlagProtected` | Attempted to clear `FLAG_DAO_COMMITTEE` via the timelock execute path (blocked on-chain — use DAO governance) |

---

## Security Notes

- **One op at a time.** Proposing a new op overwrites any existing pending op. Verify on-chain state before proposing if you need to preserve a pending op.
- **`setPythFeed` is immediate.** Unlike the timelocked ops, `setPythFeed` takes effect the moment the transaction lands. Set this at protocol initialisation and monitor for unexpected changes.
- **Delay is configurable.** `config.admin_timelock_delay` can be changed via protocol governance. The default is `DEFAULT_ADMIN_TIMELOCK_DELAY` (432 000 slots ≈ 2 days).
- **Compliance authority always enforces min delay (BUG-019).** For `ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` (10), the on-chain program uses `max(admin_timelock_delay, DEFAULT_ADMIN_TIMELOCK_DELAY)`. A compromised admin cannot shorten the delay and immediately hijack the compliance authority.
- **`updateRoles(newComplianceAuthority)` is permanently blocked.** Since BUG-019, any direct compliance authority change via `update_roles` returns `ComplianceAuthorityRequiresTimelock`. The only valid path is `proposeTimelockOp` (op_kind=10). See [on-chain-sdk-admin.md](./on-chain-sdk-admin.md).
- **Key rotation fallback.** If the admin key is lost before a pending authority transfer executes, the protocol is locked. Maintain a secure backup key and test the rotation flow on devnet before mainnet.

---

## Audit Findings

### AUDIT-A HIGH-06 — Oracle Config Not Behind Timelock

**Fixed in:** on-chain program commit `b4fd126` tests; enforcement already present from BUG-010 (`require_timelock_executed` in both handlers). Doc corrected 2026-03-25.

**Description:** `AUDIT-A HIGH-06` identified that `set_pyth_feed` (ADMIN_OP_SET_PYTH_FEED, op_kind=4) and `set_oracle_params` (ADMIN_OP_SET_ORACLE_PARAMS, op_kind=5) were not explicitly documented as timelock-protected. The on-chain enforcement (`require_timelock_executed`) was added in BUG-010 but SDK docs and oracle-params docs described `setPythFeed` as "immediate" and `set_oracle_params` as "authority-only" without mentioning the timelock requirement.

**Impact:** Callers following the old documentation would attempt direct invocations that are silently rejected by the on-chain program, causing confusing `Unauthorized` / `TimelockNotPending` errors in production.

**Fix:** Both ops now documented as timelock-protected. `ADMIN_OP_SET_PYTH_FEED` (4) and `ADMIN_OP_SET_ORACLE_PARAMS` (5) added to the enum table. `setPythFeed()` and new `setOracleParams()` SDK methods updated with correct propose → wait → execute examples. Verified by BUG-017 test suite (10 tests, BUG-017-01 through BUG-017-10).

**Upgrade action:** Any caller using `timelock.setPythFeed()` expecting immediate effect must adopt the two-step flow (propose + executeTimelockOp after delay). See updated examples above.

---

### AUDIT-F2 (HIGH) — `ADMIN_OP_NONE` Denial-of-Service via `proposeTimelockOp`

**Fixed in:** `sdk@3e4cddf` (2026-03-24)

**Description:** Prior to this fix, `proposeTimelockOp` accepted `opKind = ADMIN_OP_NONE` (0). A no-op proposal stores a pending op with a full `mature_slot` 2 days in the future. Because only **one** op can be pending at a time, any subsequent legitimate proposal (`ADMIN_OP_TRANSFER_AUTHORITY`, `ADMIN_OP_SET_FEATURE_FLAG`, `ADMIN_OP_CLEAR_FEATURE_FLAG`) either overwrites or is blocked until the no-op's delay expires. A misconfigured caller — or an attacker who can invoke the authority — can repeatedly submit no-op proposals to grief admin operations indefinitely.

**Fix:** `proposeTimelockOp` now throws `SSSError` synchronously before making any RPC call if `opKind === ADMIN_OP_NONE`:

```typescript
// Throws — never reaches the program:
await timelock.proposeTimelockOp({ mint, opKind: ADMIN_OP_NONE, param: 0n, target: PublicKey.default });
// SSSError: proposeTimelockOp: opKind must not be ADMIN_OP_NONE (0). Use ADMIN_OP_TRANSFER_AUTHORITY (1), ...
```

**Upgrade action:** No migration required for callers that already pass a valid `opKind`. Callers that previously relied on `ADMIN_OP_NONE` (likely by accident) will now get a clear error message at the SDK layer.

---

### BUG-019 (HIGH) — Compliance Authority Hijack via 2-Tx Pattern with No Timelock

**Fixed in:** `programs/sss-token` commit `23a2161` (2026-03-26)

**Description:** Prior to this fix, `update_roles` only blocked compliance authority changes when `config.admin_timelock_delay > 0`. An attacker (or compromised admin) could execute a 2-transaction hijack: (1) call `set_admin_timelock_delay(0)` to zero out the delay, then (2) call `update_roles(newComplianceAuthority)` to transfer the compliance authority immediately with no timelock protection.

Additionally, when using `propose_timelocked_op` (op_kind=10) for compliance authority transfers, the effective delay was `admin_timelock_delay` — which could also be reduced to near-zero before proposing.

**Fix:**
1. `update_roles`: Permanently returns `ComplianceAuthorityRequiresTimelock` when `new_compliance_authority` is set — unconditionally, regardless of `admin_timelock_delay`.
2. `propose_timelocked_op`: For `op_kind = ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY (10)`, the effective delay is `max(admin_timelock_delay, DEFAULT_ADMIN_TIMELOCK_DELAY)` (432 000 slots ≈ 48 h), so a reduced delay cannot shorten this wait.

**New error variant:** `ComplianceAuthorityRequiresTimelock` — "Compliance authority transfer always requires propose_timelocked_op (op_kind=10) with minimum 432_000 slot delay"

**Migration:** Any caller using `update_roles` for compliance authority changes must switch to `proposeTimelockOp({ opKind: ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY, target: newComplianceKey, param: 0n, mint })` followed by `executeTimelockOp` after the 432 000-slot maturity, and then `acceptComplianceAuthority()` from the new compliance wallet.
