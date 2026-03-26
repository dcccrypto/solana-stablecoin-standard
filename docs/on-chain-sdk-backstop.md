# SSS — On-Chain SDK: BadDebtBackstopModule

> **Class:** `BadDebtBackstopModule` (`sdk/src/BadDebtBackstopModule.ts`)
> **Added:** SSS-097 (core) · **Extended:** SSS-100 (fund management + coverage helpers)
> **Preset restriction:** Preset 3 (reserve-backed) only

---

## Overview

`BadDebtBackstopModule` is the SDK client for the SSS bad-debt backstop system.
When a CDP liquidation yields a collateral shortfall (debt > recovered collateral),
the protocol draws from a pre-funded insurance vault to cover the gap — preventing
bad debt from accruing against the stablecoin supply.

**SSS-097** introduced the core on-chain instructions (`set_backstop_params`,
`trigger_backstop`) and the original SDK wrappers.

**SSS-100** extended the module with:

- `contributeToBackstop` — deposit collateral tokens into the insurance fund
- `withdrawFromBackstop` — withdraw tokens from the insurance fund (authority only)
- `triggerBadDebtSocialization` — ergonomic alias for `triggerBackstop`
- `fetchBackstopFundState` — reads config + live vault balance in one call
- `computeCoverageRatio` — off-chain ratio of fund balance to net supply

---

## Import

```typescript
import { BadDebtBackstopModule } from '@sss/sdk';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
```

---

## Constructor

```typescript
const backstop = new BadDebtBackstopModule(provider, programId);
```

| Parameter   | Type             | Description                     |
|-------------|------------------|---------------------------------|
| `provider`  | `AnchorProvider` | Wallet + connection provider.   |
| `programId` | `PublicKey`      | Deployed SSS program address.   |

---

## Constants

```typescript
export const MAX_BACKSTOP_BPS = 10_000;
```

Upper bound for `maxBackstopBps` enforced both on-chain and in the SDK.

---

## Methods

### `setBackstopParams(args)` — authority write

Configure the insurance fund vault and max draw cap on `StablecoinConfig`.

```typescript
await backstop.setBackstopParams({
  mint,
  insuranceFundPubkey: insuranceFundTokenAccount,
  maxBackstopBps: 500, // 5% of net supply
});
```

| Param                  | Type        | Description                                                    |
|------------------------|-------------|----------------------------------------------------------------|
| `mint`                 | `PublicKey` | SSS-3 stablecoin mint.                                         |
| `insuranceFundPubkey`  | `PublicKey` | Insurance fund token account. Pass `PublicKey.default()` to disable. |
| `maxBackstopBps`       | `number`    | Max draw cap in bps of net supply (0–10 000). `0` = unlimited. |

**Returns:** `Promise<TransactionSignature>`

**Throws:** If `maxBackstopBps > 10_000`.

---

### `triggerBackstop(args)` — CPI-only (testing/simulation)

Draw collateral from the insurance fund to cover a post-liquidation shortfall.

> **Note:** On-chain this instruction is CPI-only — the config PDA must be the
> signer, so it can only be invoked from within `cdp_liquidate`. The SDK method
> is intended for local-validator testing, simulation, and composable transaction
> building only.

> **BUG-031 (commit 1407e2c):** `shortfallAmount` has been **removed**. The
> shortfall is now computed entirely on-chain from `CdpPosition.debt_amount`,
> `CollateralVault.deposited_amount`, and the oracle price feed. The instruction
> reverts with `NoBadDebt` if collateral value covers the full debt at trigger
> time. This prevents callers from inflating the shortfall to drain more from
> the insurance fund than the actual deficit. The `BadDebtTriggered` event now
> includes a `computed_shortfall` field reflecting the on-chain calculation.

```typescript
await backstop.triggerBackstop({
  mint,
  cdpOwner,
  oraclePriceFeed,
  insuranceFund,
  reserveVault,
  collateralMint,
  insuranceFundAuthority,
  collateralTokenProgram: TOKEN_PROGRAM_ID,
});
```

| Param                      | Type        | Description                                                      |
|----------------------------|-------------|------------------------------------------------------------------|
| `mint`                     | `PublicKey` | SSS-3 stablecoin mint.                                           |
| `cdpOwner`                 | `PublicKey` | Owner of the CDP position being backstopped.                     |
| `oraclePriceFeed`          | `PublicKey` | Oracle price feed account for collateral valuation.              |
| `insuranceFund`            | `PublicKey` | Insurance fund token account (source).                           |
| `reserveVault`             | `PublicKey` | Reserve vault token account (destination).                       |
| `collateralMint`           | `PublicKey` | Collateral token mint.                                           |
| `insuranceFundAuthority`   | `PublicKey` | Authority signing the insurance fund transfer.                   |
| `collateralTokenProgram`   | `PublicKey` | Token program for collateral.                                    |

The SDK derives `CdpPosition` and `CollateralVault` PDAs client-side from
`cdpOwner` before building the transaction.

**Returns:** `Promise<TransactionSignature>`

**Throws:** If the CDP position is not under-water at execution time (`NoBadDebt`).

---

### `triggerBadDebtSocialization(args)` *(SSS-100)*

Ergonomic alias for `triggerBackstop`. Accepts the same `TriggerBackstopArgs` /
`TriggerBadDebtSocializationArgs` parameter shape and delegates directly.

```typescript
await backstop.triggerBadDebtSocialization({
  mint,
  cdpOwner,
  oraclePriceFeed,
  insuranceFund,
  reserveVault,
  collateralMint,
  insuranceFundAuthority,
  collateralTokenProgram: TOKEN_PROGRAM_ID,
});
```

---

### `contributeToBackstop(args)` *(SSS-100)*

Deposit collateral tokens from a contributor's source account into the insurance fund vault.

Builds a standard SPL `transfer_checked` instruction — no custom program instruction needed.

```typescript
await backstop.contributeToBackstop({
  insuranceFund: insuranceFundTokenAccount,
  sourceTokenAccount: contributorUsdcAta,
  contributor: contributorWallet,
  collateralMint: USDC_MINT,
  collateralDecimals: 6,
  amount: 1_000_000n, // 1 USDC
});
```

| Param                  | Type        | Description                                                       |
|------------------------|-------------|-------------------------------------------------------------------|
| `insuranceFund`        | `PublicKey` | Destination: the backstop vault token account.                    |
| `sourceTokenAccount`   | `PublicKey` | Contributor's source token account.                               |
| `contributor`          | `PublicKey` | Contributor's wallet (signer).                                    |
| `collateralMint`       | `PublicKey` | Collateral token mint.                                            |
| `collateralDecimals`   | `number`    | Decimals of the collateral mint.                                  |
| `amount`               | `bigint`    | Amount to deposit in native token units (must be > 0).            |
| `tokenProgram?`        | `PublicKey` | Token program (default: `TOKEN_PROGRAM_ID`).                      |

**Returns:** `Promise<TransactionSignature>`

**Throws:** If `amount <= 0n`.

---

### `withdrawFromBackstop(args)` *(SSS-100)*

Withdraw collateral tokens from the insurance fund to a destination account.
The insurance fund authority must sign.

```typescript
await backstop.withdrawFromBackstop({
  insuranceFund: insuranceFundTokenAccount,
  insuranceFundAuthority: fundAuthorityKeypair.publicKey,
  destinationTokenAccount: adminUsdcAta,
  collateralMint: USDC_MINT,
  collateralDecimals: 6,
  amount: 500_000n,
});
```

| Param                       | Type        | Description                                                |
|-----------------------------|-------------|------------------------------------------------------------|
| `insuranceFund`             | `PublicKey` | Source: insurance fund token account.                      |
| `insuranceFundAuthority`    | `PublicKey` | Authority controlling the fund (signer).                   |
| `destinationTokenAccount`   | `PublicKey` | Destination token account.                                 |
| `collateralMint`            | `PublicKey` | Collateral token mint.                                     |
| `collateralDecimals`        | `number`    | Decimals of the collateral mint.                           |
| `amount`                    | `bigint`    | Amount to withdraw in native units (must be > 0).          |
| `tokenProgram?`             | `PublicKey` | Token program (default: `TOKEN_PROGRAM_ID`).               |

**Returns:** `Promise<TransactionSignature>`

**Throws:** If `amount <= 0n`.

---

### `fetchBackstopConfig(mint)` — read

Fetch backstop configuration from `StablecoinConfig` on-chain.

```typescript
const config = await backstop.fetchBackstopConfig(mint);
// { insuranceFundPubkey, maxBackstopBps, enabled }
```

**Returns:** `Promise<BackstopConfig>`

---

### `fetchBackstopFundState(mint)` *(SSS-100)* — read

Fetch config **plus** the live insurance fund vault balance in one call.

```typescript
const state = await backstop.fetchBackstopFundState(mint);
console.log(state.fundBalance, state.fundMint);
```

**Returns:** `Promise<BackstopFundState>`

```typescript
interface BackstopFundState {
  insuranceFundPubkey: PublicKey;  // vault account (default pubkey if disabled)
  maxBackstopBps: number;          // max draw cap in bps
  enabled: boolean;                // true when fund is configured
  fundBalance: bigint;             // current native token balance (0 if disabled)
  fundMint: PublicKey;             // collateral mint of the vault
}
```

**Throws:** If the insurance fund token account is not found on-chain (when enabled).

---

### `isBackstopEnabled(mint)` — read

Returns `true` when a valid insurance fund is configured.

```typescript
const active = await backstop.isBackstopEnabled(mint);
```

---

### `computeMaxDraw(params)` — off-chain

Replicate the on-chain `trigger_backstop` draw calculation locally. Since
**BUG-031** the on-chain shortfall is computed from CDP + oracle state, not
supplied by the caller. Use `computeOnChainShortfall` (below) to derive the
shortfall before passing it here.

```typescript
const draw = backstop.computeMaxDraw({
  netSupply: 1_000_000n,
  maxBackstopBps: 500,      // 5%
  shortfall: 40_000n,       // obtained from computeOnChainShortfall or BadDebtTriggered.computed_shortfall
  insuranceFundBalance: 100_000n,
});
// draw = 40_000n (shortfall is the binding constraint; fund has enough)
```

**Logic:**
```
max_draw = maxBackstopBps == 0
  ? shortfall
  : min(netSupply * maxBackstopBps / 10_000, shortfall)

actual_draw = min(max_draw, insuranceFundBalance)  // when balance provided
```

---

### `computeOnChainShortfall(params)` — off-chain *(BUG-031)*

Mirror the on-chain shortfall formula client-side for pre-flight checks and
monitoring. Returns `0n` if the position is solvent.

```typescript
const shortfall = backstop.computeOnChainShortfall({
  debtAmount: 1_000_000n,      // CdpPosition.debt_amount (native SSS units)
  accruedFees: 5_000n,         // CdpPosition.accrued_fees
  depositedAmount: 100_000n,   // CollateralVault.deposited_amount (native collateral units)
  oraclePrice: 99_950_000n,    // oracle price mantissa
  priceExpoAbs: 8,             // |expo| (e.g. 8 for 1e-8 price)
  collateralDecimals: 6,       // collateral mint decimals
  sssDecimals: 6,              // SSS mint decimals
});
```

**Formula (mirrors on-chain):**
```
effective_debt = debt_amount + accrued_fees
collateral_value_in_sss = deposited * oracle_price * 10^sss_decimals
                          / (10^coll_decimals * 10^price_expo_abs)
shortfall = max(0, effective_debt - collateral_value_in_sss)
```

Returns `0n` when `collateral_value_in_sss >= effective_debt`.

---

### `computeCoverageRatio(fundBalance, netSupply)` *(SSS-100)* — off-chain

Returns the ratio of the insurance fund balance to outstanding net supply.
A ratio ≥ 1.0 means the fund can fully cover a total supply shortfall.

```typescript
const ratio = backstop.computeCoverageRatio(50_000n, 1_000_000n);
// ratio = 0.05 (5% coverage)
```

Returns `0` when `netSupply` is `0n`.

---

### `computeRemainingShortfall(shortfall, backstopDraw)` — off-chain

Returns `shortfall - backstopDraw` or `0n` if fully covered.

```typescript
const remaining = backstop.computeRemainingShortfall(40_000n, 30_000n);
// remaining = 10_000n
```

---

### `configPda(mint)` — PDA helper

Derives the `StablecoinConfig` PDA for a given mint.

```typescript
const [pda, bump] = backstop.configPda(mint);
```

Seeds: `["stablecoin-config", mint]`

---

## Type Reference

```typescript
interface SetBackstopParamsArgs {
  mint: PublicKey;
  insuranceFundPubkey: PublicKey;
  maxBackstopBps: number;
}

// BUG-031: shortfallAmount removed; shortfall now computed on-chain.
// cdpOwner + oraclePriceFeed added so the instruction can read CDP/vault PDAs.
interface TriggerBackstopArgs {
  mint: PublicKey;
  cdpOwner: PublicKey;         // owner of the CDP position being backstopped
  oraclePriceFeed: PublicKey;  // price feed used for collateral valuation
  insuranceFund: PublicKey;
  reserveVault: PublicKey;
  collateralMint: PublicKey;
  insuranceFundAuthority: PublicKey;
  collateralTokenProgram: PublicKey;
}

// TriggerBadDebtSocializationArgs = TriggerBackstopArgs

interface ContributeToBackstopArgs {
  insuranceFund: PublicKey;
  sourceTokenAccount: PublicKey;
  contributor: PublicKey;
  collateralMint: PublicKey;
  collateralDecimals: number;
  amount: bigint;
  tokenProgram?: PublicKey;
}

interface WithdrawFromBackstopArgs {
  insuranceFund: PublicKey;
  insuranceFundAuthority: PublicKey;
  destinationTokenAccount: PublicKey;
  collateralMint: PublicKey;
  collateralDecimals: number;
  amount: bigint;
  tokenProgram?: PublicKey;
}

interface BackstopConfig {
  insuranceFundPubkey: PublicKey;
  maxBackstopBps: number;
  enabled: boolean;
}

interface BackstopFundState extends BackstopConfig {
  fundBalance: bigint;
  fundMint: PublicKey;
}

// BUG-031: on-chain shortfall pre-flight helper
interface ComputeOnChainShortfallParams {
  debtAmount: bigint;
  accruedFees: bigint;
  depositedAmount: bigint;
  oraclePrice: bigint;
  priceExpoAbs: number;
  collateralDecimals: number;
  sssDecimals: number;
}

// BadDebtTriggered event (on-chain) — BUG-031 adds computed_shortfall
interface BadDebtTriggeredEvent {
  sssMint: PublicKey;
  backstopAmount: bigint;
  computedShortfall: bigint; // added BUG-031: on-chain-derived shortfall
  remainingShortfall: bigint;
  netSupply: bigint;
}
```

---

## On-Chain Layout Notes

`insurance_fund_pubkey` (32 bytes) and `max_backstop_bps` (u16) are appended
at the tail of `StablecoinConfig`. The SDK reads them at fixed negative offsets:

| Field                   | Offset from end | Size  |
|-------------------------|-----------------|-------|
| `max_backstop_bps`      | −13             | 2 B   |
| `insurance_fund_pubkey` | −45             | 32 B  |

> These fields were added by SSS-097. Earlier `StablecoinConfig` accounts
> (pre-SSS-097) will not have these bytes and will return garbage values.
> Always migrate configs with `set_backstop_params` before reading.

---

## End-to-End Example

```typescript
import { BadDebtBackstopModule } from '@sss/sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const backstop = new BadDebtBackstopModule(provider, programId);

// 1. Configure the insurance fund (admin, once)
await backstop.setBackstopParams({
  mint,
  insuranceFundPubkey: insuranceFundAta,
  maxBackstopBps: 500, // 5% cap
});

// 2. Contributors deposit into the fund
await backstop.contributeToBackstop({
  insuranceFund: insuranceFundAta,
  sourceTokenAccount: contributorAta,
  contributor: wallet.publicKey,
  collateralMint: USDC_MINT,
  collateralDecimals: 6,
  amount: 10_000_000n, // 10 USDC
});

// 3. Monitor fund health
const state = await backstop.fetchBackstopFundState(mint);
const ratio = backstop.computeCoverageRatio(state.fundBalance, netSupply);
console.log(`Coverage: ${(ratio * 100).toFixed(2)}%`);

// 4. Pre-flight: estimate on-chain shortfall for a CDP before triggering
// (BUG-031: shortfall is now computed on-chain; use this for monitoring only)
const shortfall = backstop.computeOnChainShortfall({
  debtAmount: cdpPosition.debtAmount,
  accruedFees: cdpPosition.accruedFees,
  depositedAmount: collateralVault.depositedAmount,
  oraclePrice: BigInt(oraclePriceData.price),
  priceExpoAbs: Math.abs(oraclePriceData.exponent),
  collateralDecimals: collateralMintInfo.decimals,
  sssDecimals: sssMintInfo.decimals,
});

// 5. Estimate draw cap
const draw = backstop.computeMaxDraw({
  netSupply,
  maxBackstopBps: state.maxBackstopBps,
  shortfall,
  insuranceFundBalance: state.fundBalance,
});
```
