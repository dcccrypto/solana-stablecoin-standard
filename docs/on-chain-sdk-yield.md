# SSS — On-Chain SDK: YieldCollateralModule

> **Class:** `YieldCollateralModule` (`sdk/src/YieldCollateralModule.ts`)
> **Added:** SSS-072 | **Feature flag:** `FLAG_YIELD_COLLATERAL` (bit 3, `0x08`)
> **Depends on:** SSS-3 (reserve-backed) stablecoins only

---

## Overview

`YieldCollateralModule` lets stablecoin issuers accept yield-bearing SPL token
mints (stSOL, mSOL, jitoSOL, bSOL, etc.) as CDP collateral by maintaining a
whitelisted set of up to 8 approved collateral mints.

When `FLAG_YIELD_COLLATERAL` is set in `StablecoinConfig.feature_flags`, CDP
borrowers may deposit any whitelisted yield-bearing mint instead of raw SOL or
a plain SPL token.  The whitelist is stored in a dedicated `YieldCollateralConfig`
PDA so that it persists even if the flag is temporarily cleared.

### Workflow

1. Admin calls `enableYieldCollateral` — creates the `YieldCollateralConfig`
   PDA and atomically sets `FLAG_YIELD_COLLATERAL`.
2. Admin calls `addWhitelistedMint` for each yield-bearing token to accept.
3. CDP borrowers deposit whitelisted mints as collateral.
4. Admin calls `disableYieldCollateral` to clear the flag (PDA preserved).
5. To re-enable without re-initialising, call `setFeatureFlag` directly or
   call `enableYieldCollateral` again (will fail if PDA already exists — use
   `set_feature_flag` instruction directly for re-enable).

---

## `FLAG_YIELD_COLLATERAL`

```typescript
export const FLAG_YIELD_COLLATERAL = 1n << 3n; // 0x08
```

**Anchor constant:**

```rust
pub const FLAG_YIELD_COLLATERAL: u64 = 1 << 3; // 0x08
```

| Property | Value |
|---|---|
| Bit position | 3 |
| Hex value | `0x08` |
| BigInt literal | `8n` |

When set in `StablecoinConfig.feature_flags`, the program allows yield-bearing
collateral mints listed in `YieldCollateralConfig.whitelisted_mints` to be
deposited as CDP collateral.

---

## Import

```typescript
import {
  YieldCollateralModule,
  FLAG_YIELD_COLLATERAL,
  type YieldCollateralState,
  type EnableYieldCollateralParams,
  type DisableYieldCollateralParams,
  type AddWhitelistedMintParams,
} from '@sss/sdk';
```

---

## Instantiation

```typescript
import { AnchorProvider } from '@coral-xyz/anchor';
import { YieldCollateralModule } from '@sss/sdk';

const yc = new YieldCollateralModule(provider, programId);
```

| Parameter | Type | Description |
|---|---|---|
| `provider` | `AnchorProvider` | Anchor provider; wallet must be admin authority for write ops. |
| `programId` | `PublicKey` | Deployed SSS token program ID. |

---

## PDA Helpers

### `getConfigPda(mint)`

Derive the `StablecoinConfig` PDA for the given mint.

```typescript
getConfigPda(mint: PublicKey): [PublicKey, number]
```

Seeds: `["stablecoin-config", mint]`

### `getYieldCollateralPda(mint)`

Derive the `YieldCollateralConfig` PDA for the given mint.

```typescript
getYieldCollateralPda(mint: PublicKey): [PublicKey, number]
```

Seeds: `["yield-collateral", mint]`

---

## Methods

### `enableYieldCollateral(params)`

Create the `YieldCollateralConfig` PDA and set `FLAG_YIELD_COLLATERAL`.

```typescript
enableYieldCollateral(params: EnableYieldCollateralParams): Promise<TransactionSignature>
```

Wraps the `init_yield_collateral` Anchor instruction.  Optionally accepts an
initial whitelist of up to 8 yield-bearing mints.

**Authority required:** admin authority.

**Only valid for SSS-3** (reserve-backed) stablecoins.

> Fails if the `YieldCollateralConfig` PDA already exists.  To re-enable
> after disabling, call `setFeatureFlag({ mint, flag: FLAG_YIELD_COLLATERAL })`
> via `FeatureFlagsModule` instead.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint (SSS-3 preset). |
| `initialMints` | `PublicKey[]` | | Initial whitelist (max 8). Defaults to `[]`. |

**Example:**

```typescript
const stSolMint = new PublicKey('7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj');
const mSolMint  = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

const sig = await yc.enableYieldCollateral({
  mint,
  initialMints: [stSolMint, mSolMint],
});
console.log('Enabled yield collateral:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |
| `SssError::YieldCollateralAlreadyInitialised` | `YieldCollateralConfig` PDA already exists. |
| `SssError::WhitelistFull` | `initialMints` exceeds the 8-mint cap. |

---

### `disableYieldCollateral(params)`

Clear `FLAG_YIELD_COLLATERAL` for this mint.

```typescript
disableYieldCollateral(params: DisableYieldCollateralParams): Promise<TransactionSignature>
```

Wraps `clear_feature_flag` with `FLAG_YIELD_COLLATERAL`.  The
`YieldCollateralConfig` PDA is **not** closed — the whitelist is preserved for
re-enabling later.

**Authority required:** admin authority.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint. |

**Example:**

```typescript
const sig = await yc.disableYieldCollateral({ mint });
console.log('Disabled yield collateral:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |

---

### `addWhitelistedMint(params)`

Add a yield-bearing SPL token mint to the whitelist.

```typescript
addWhitelistedMint(params: AddWhitelistedMintParams): Promise<TransactionSignature>
```

Wraps `add_yield_collateral_mint`.  Requires `FLAG_YIELD_COLLATERAL` to be
active.  Rejects duplicates and enforces the 8-mint cap.

**Authority required:** admin authority.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint. |
| `collateralMint` | `PublicKey` | ✓ | Yield-bearing SPL token mint to whitelist. |

**Example:**

```typescript
const jitoSolMint = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');

const sig = await yc.addWhitelistedMint({ mint, collateralMint: jitoSolMint });
console.log('Added jitoSOL to whitelist:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |
| `SssError::YieldCollateralNotEnabled` | `FLAG_YIELD_COLLATERAL` is not set. |
| `SssError::MintAlreadyWhitelisted` | `collateralMint` is already in the list. |
| `SssError::WhitelistFull` | Whitelist already contains 8 mints. |

---

### `fetchYieldCollateralState(mint)`

Fetch and decode the `YieldCollateralConfig` PDA from on-chain.

```typescript
fetchYieldCollateralState(mint: PublicKey): Promise<YieldCollateralState | null>
```

Returns `null` if the account has not been initialised yet.

**Example:**

```typescript
const state = await yc.fetchYieldCollateralState(mint);
if (state) {
  console.log('Whitelisted mints:');
  state.whitelistedMints.forEach(m => console.log(' ', m.toBase58()));
} else {
  console.log('YieldCollateralConfig not initialised.');
}
```

---

### `isYieldCollateralEnabled(mint)`

Check whether `FLAG_YIELD_COLLATERAL` is currently set for a mint.

```typescript
isYieldCollateralEnabled(mint: PublicKey): Promise<boolean>
```

Reads `StablecoinConfig.feature_flags` on-chain.  Returns `false` if the
config account does not exist.

**Example:**

```typescript
const enabled = await yc.isYieldCollateralEnabled(mint);
console.log('Yield collateral active:', enabled);
```

---

## `YieldCollateralState` Account Layout

The `YieldCollateralConfig` PDA stores the following fields:

| Field | Rust type | TS type | Description |
|---|---|---|---|
| `sss_mint` | `Pubkey` | `PublicKey` | Stablecoin mint this config belongs to. |
| `whitelisted_mints` | `Vec<Pubkey>` (max 8) | `PublicKey[]` | Approved yield-bearing collateral mints. |
| `bump` | `u8` | `number` | PDA bump seed. |

**PDA seeds:** `["yield-collateral", sss_mint]`

```typescript
export interface YieldCollateralState {
  sssMint: PublicKey;
  whitelistedMints: PublicKey[];  // max 8
  bump: number;
}
```

---

## External Protocol Risk Caveats

Yield-bearing LSTs carry risks beyond standard SPL token collateral.  Issuers
**must** account for the following before whitelisting any mint:

### Smart-contract risk

stSOL (Lido), mSOL (Marinade), jitoSOL (Jito), and bSOL (BlazeStake) each
introduce a separate protocol contract stack.  An exploit or misconfiguration
in any of those protocols may cause the LST to de-peg from SOL, reducing
collateral value below the loan principal.

**Mitigation:** use a conservative LTV (loan-to-value) ratio, e.g. 60–70%,
lower than for plain SOL (typically 75–80%).

### Oracle dependency

Collateral valuation requires a price feed that correctly tracks the LST/SOL
exchange rate (e.g. Pyth `stSOL/USD` or computed via the stake-pool
`epoch_stake_pool_state.sol_per_token` ratio).  Stale or manipulated feeds
can open the protocol to under-collateralised borrowing.

**Mitigation:** use only audited, on-chain oracles; apply a liquidation buffer.

### Liquidity risk

LST mints may have limited DEX liquidity, making on-chain liquidations
difficult during volatile periods.

**Mitigation:** limit total exposure per whitelisted mint; integrate a
liquidation bot that bridges to Marinade/Jito unstake queues.

### Withdrawal queue risk

Unstaking staked SOL is subject to epoch-boundary settlement (~2–3 days) unless
using an instant-unstake facility (which carries fee and liquidity risk).
Liquidators must factor this into their profitability models.

> **Recommendation:** start with a single widely-adopted LST (e.g. mSOL or
> jitoSOL), monitor collateral health, and expand the whitelist incrementally
> after establishing liquidation infrastructure.

---

## Error Codes

| Error | Description |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |
| `SssError::YieldCollateralAlreadyInitialised` | `init_yield_collateral` called when PDA already exists. |
| `SssError::YieldCollateralNotEnabled` | `add_yield_collateral_mint` called without `FLAG_YIELD_COLLATERAL` set. |
| `SssError::MintAlreadyWhitelisted` | Collateral mint is already in `whitelisted_mints`. |
| `SssError::WhitelistFull` | `whitelisted_mints` has reached the 8-mint cap. |

---

## TypeScript End-to-End Example

```typescript
import { AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  YieldCollateralModule,
  FLAG_YIELD_COLLATERAL,
} from '@sss/sdk';

// ── Known LST mints (mainnet) ────────────────────────────────────────────────
const ST_SOL  = new PublicKey('7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj');
const M_SOL   = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const JITO    = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const B_SOL   = new PublicKey('bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1');

async function main(
  provider: AnchorProvider,
  programId: PublicKey,
  mint: PublicKey,
) {
  const yc = new YieldCollateralModule(provider, programId);

  // 1. Enable — creates YieldCollateralConfig PDA, sets FLAG_YIELD_COLLATERAL
  //    Seed the whitelist with stSOL and mSOL right away
  const enableSig = await yc.enableYieldCollateral({
    mint,
    initialMints: [ST_SOL, M_SOL],
  });
  console.log('Enabled:', enableSig);

  // 2. Add jitoSOL later
  const addSig = await yc.addWhitelistedMint({
    mint,
    collateralMint: JITO,
  });
  console.log('Added jitoSOL:', addSig);

  // 3. Inspect state
  const state = await yc.fetchYieldCollateralState(mint);
  console.log('Whitelisted mints:', state?.whitelistedMints.map(m => m.toBase58()));
  // → ['7dHbWX...', 'mSoLzY...', 'J1toso...']

  // 4. Check flag
  const active = await yc.isYieldCollateralEnabled(mint);
  console.log('Active:', active); // → true

  // 5. Read bitmask manually
  const [configPda] = yc.getConfigPda(mint);
  // ... fetch config and decode feature_flags if needed

  // 6. Temporarily disable (whitelist preserved on-chain)
  const disableSig = await yc.disableYieldCollateral({ mint });
  console.log('Disabled:', disableSig);

  // 7. Re-enable without re-creating PDA
  //    (use FeatureFlagsModule.setFeatureFlag, not enableYieldCollateral)
  // await ff.setFeatureFlag({ mint, flag: FLAG_YIELD_COLLATERAL });
}
```

---

## See Also

- [`feature-flags.md`](./feature-flags.md) — full flag constants table and `FeatureFlagsModule`
- [`on-chain-sdk-cdp.md`](./on-chain-sdk-cdp.md) — CDP deposit/borrow/repay flows
- [`on-chain-sdk-admin.md`](./on-chain-sdk-admin.md) — admin authority, pause/unpause
- [`on-chain-sdk-dao.md`](./on-chain-sdk-dao.md) — DAO committee governance (FLAG_DAO_COMMITTEE)
