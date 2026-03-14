# SSS — On-Chain SDK: Authority Transfer & Collateral Methods

> **Class:** `SolanaStablecoin` (`sdk/src/SolanaStablecoin.ts`)
> **Requires:** SSS-019 IDL + `feat/sss-021-sdk-two-step-maxsupply-tests` on main

---

## Overview

This document covers the newer governance and SSS-3 reserve methods added after the initial SDK release:

- **Two-step authority transfer** — `proposeAuthority` → `acceptAuthority` / `acceptComplianceAuthority`
- **SSS-3 collateral operations** — `depositCollateral`, `redeem`

These sit alongside the admin methods described in [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) and the core lifecycle in [on-chain-sdk-core.md](./on-chain-sdk-core.md).

All methods:
- Require a configured `AnchorProvider` with a funded wallet
- Return `Promise<TransactionSignature>` at `confirmed` commitment
- Emit Anchor events you can subscribe to with `program.addEventListener`

---

## Two-Step Authority Transfer

Transferring admin or compliance authority is a two-transaction flow. This prevents accidental hand-offs: the *current* authority proposes, then the *new* authority accepts.

```
Current admin                        Proposed admin
       │                                    │
       │─── proposeAuthority() ────────────>│  stores pending_authority on PDA
       │                                    │
       │                          acceptAuthority() ──> transfer complete
```

Anchor events emitted:
- `AuthorityProposed` (on propose)
- `AuthorityAccepted` (on accept)

---

### `proposeAuthority(params, isCompliance?)`

**Step 1 of 2.** Sets `pending_authority` (or `pending_compliance_authority`) on the config PDA. The current holder of the appropriate authority must sign.

```typescript
import { PublicKey } from '@solana/web3.js';

// Propose a new admin authority
const sig = await stablecoin.proposeAuthority({
  proposed: new PublicKey('NewAdminWalletAddress...'),
});

// Propose a new compliance authority instead
const sig = await stablecoin.proposeAuthority(
  { proposed: new PublicKey('NewComplianceWallet...') },
  true // isCompliance = true
);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `params.proposed` | `PublicKey` | The proposed new authority's public key |
| `isCompliance` | `boolean` | `false` (default) = admin authority; `true` = compliance authority |

**Accounts:**

| Account | Description |
|---------|-------------|
| `authority` | Provider wallet — must be the current admin authority |
| `config` | Config PDA `[b"stablecoin-config", mint]` |
| `mint` | Stablecoin Token-2022 mint |

**Errors:**
| Error | Cause |
|-------|-------|
| `Unauthorized` | Caller is not the current admin authority |

---

### `acceptAuthority()`

**Step 2 of 2 (admin).** Must be called by the wallet that was set as `pending_authority`. Atomically clears the pending field and sets the new authority on the config PDA.

```typescript
// Called by the NEW admin wallet
const sig = await stablecoin.acceptAuthority();
console.log('Admin authority transferred:', sig);
```

**Accounts:**

| Account | Description |
|---------|-------------|
| `pending` | Provider wallet — must match `config.pending_authority` |
| `config` | Config PDA |
| `mint` | Stablecoin Token-2022 mint |

**Errors:**
| Error | Cause |
|-------|-------|
| `NoPendingAuthority` | No pending authority has been proposed |
| `Unauthorized` | Caller is not the pending authority |

---

### `acceptComplianceAuthority()`

**Step 2 of 2 (compliance).** Same as `acceptAuthority()` but for the compliance authority slot.

```typescript
// Called by the NEW compliance wallet
const sig = await stablecoin.acceptComplianceAuthority();
console.log('Compliance authority transferred:', sig);
```

Accounts and errors are identical to `acceptAuthority()`.

---

### Full Example: Rotating the Admin Key

```typescript
import { SolanaStablecoin } from '@stbr/sss-token';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');

// Current admin
const currentAdmin = Keypair.fromSecretKey(/* ... */);
const currentProvider = new AnchorProvider(connection, new Wallet(currentAdmin), {});
const stablecoin = new SolanaStablecoin(currentProvider, mint);

// Step 1: propose
const newAdminKeypair = Keypair.fromSecretKey(/* ... */);
await stablecoin.proposeAuthority({ proposed: newAdminKeypair.publicKey });

// Step 2: accept (new admin signs)
const newProvider = new AnchorProvider(connection, new Wallet(newAdminKeypair), {});
const stablecoinForNew = new SolanaStablecoin(newProvider, mint);
await stablecoinForNew.acceptAuthority();

console.log('Authority rotated successfully.');
```

---

## SSS-3 Collateral Methods

These methods are only valid for mints created with the `SSS-3` preset (`reserveBacked: true` in `InitializeParams`). Calling them on an SSS-1 or SSS-2 mint will throw `InvalidPreset`.

SSS-3 maintains a **reserve vault** — a token account that holds collateral backing the stablecoin supply. The on-chain program enforces that `collateral_balance ≥ total_supply` after every mint.

---

### `depositCollateral(params)`

Transfers collateral tokens from the caller's account into the reserve vault. The caller must be a registered minter.

Emits `CollateralDeposited`.

```typescript
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const depositorCollateral = await getAssociatedTokenAddress(
  USDC_MINT,
  provider.wallet.publicKey
);
const reserveVault = await getAssociatedTokenAddress(
  USDC_MINT,
  stablecoin.configPda,  // vault owned by the config PDA
  true // allowOwnerOffCurve
);

const sig = await stablecoin.depositCollateral({
  amount: 1_000_000n,          // 1 USDC (6 decimals)
  collateralMint: USDC_MINT,
  depositorCollateral,
  reserveVault,
});
console.log('Collateral deposited:', sig);
```

**Parameters (`DepositCollateralParams`):**

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `bigint` | Collateral to deposit in base units |
| `collateralMint` | `PublicKey` | Mint of the collateral token (e.g. USDC) |
| `depositorCollateral` | `PublicKey` | Caller's collateral token account |
| `reserveVault` | `PublicKey` | Reserve vault token account (PDA-owned) |

**Accounts:**

| Account | Description |
|---------|-------------|
| `depositor` | Provider wallet (must be a registered minter) |
| `config` | Config PDA |
| `sssMint` | Stablecoin Token-2022 mint |
| `collateralMint` | Collateral token mint |
| `depositorCollateral` | Source collateral token account |
| `reserveVault` | Destination reserve vault |
| `tokenProgram` | Token-2022 program |

**Errors:**
| Error | Cause |
|-------|-------|
| `Unauthorized` | Caller is not a registered minter |
| `InvalidPreset` | Mint is not SSS-3 |
| `InsufficientCollateral` | Resulting balance would be < total supply |

---

### `redeem(params)`

Burns `amount` SSS tokens from the caller's account and transfers proportional collateral from the reserve vault back to the caller.

Emits `CollateralRedeemed`.

```typescript
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const redeemerSssAccount = await getAssociatedTokenAddress(
  stablecoin.mint,
  provider.wallet.publicKey,
  false,
  TOKEN_2022_PROGRAM_ID
);
const redeemerCollateral = await getAssociatedTokenAddress(
  USDC_MINT,
  provider.wallet.publicKey
);
const reserveVault = await getAssociatedTokenAddress(
  USDC_MINT,
  stablecoin.configPda,
  true
);

const sig = await stablecoin.redeem({
  amount: 500_000n,             // 0.5 SSS tokens (6 decimals)
  redeemerSssAccount,
  collateralMint: USDC_MINT,
  reserveVault,
  redeemerCollateral,
  // collateralTokenProgram: TOKEN_PROGRAM_ID (default, omit for SPL tokens)
});
console.log('Redeemed:', sig);
```

**Parameters (`RedeemParams`):**

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `bigint` | SSS tokens to burn (base units) |
| `redeemerSssAccount` | `PublicKey` | Caller's SSS Token-2022 account |
| `collateralMint` | `PublicKey` | Collateral token mint |
| `reserveVault` | `PublicKey` | Reserve vault token account |
| `redeemerCollateral` | `PublicKey` | Caller's collateral account (receives collateral) |
| `collateralTokenProgram` | `PublicKey?` | Token program for collateral (default: `TOKEN_PROGRAM_ID`) |

**Accounts:**

| Account | Description |
|---------|-------------|
| `redeemer` | Provider wallet |
| `config` | Config PDA |
| `sssMint` | Stablecoin Token-2022 mint (burned from) |
| `redeemerSssAccount` | Source SSS token account |
| `collateralMint` | Collateral token mint |
| `reserveVault` | Source collateral vault |
| `redeemerCollateral` | Destination collateral account |
| `sssTokenProgram` | Token-2022 program (for SSS burn) |
| `collateralTokenProgram` | Token program for collateral transfer |

**Errors:**
| Error | Cause |
|-------|-------|
| `InvalidPreset` | Mint is not SSS-3 |
| `InsufficientFunds` | Redeemer does not hold enough SSS tokens |
| `InsufficientCollateral` | Reserve vault balance too low |

---

## Listening for Events

All these methods emit Anchor events. Subscribe with the Anchor `Program` instance:

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import idl from '@stbr/sss-token/idl/sss_token.json';

const program = new Program(idl as any, provider);

program.addEventListener('AuthorityProposed', (event, slot) => {
  console.log(`Slot ${slot}: ${event.proposed.toBase58()} proposed as new authority`);
});
program.addEventListener('AuthorityAccepted', (event, slot) => {
  console.log(`Slot ${slot}: Authority accepted${event.isCompliance ? ' (compliance)' : ''}`);
});
program.addEventListener('CollateralDeposited', (event, slot) => {
  console.log(`Slot ${slot}: ${event.amount} collateral deposited`);
});
program.addEventListener('CollateralRedeemed', (event, slot) => {
  console.log(`Slot ${slot}: ${event.amount} redeemed`);
});
```

Remove listeners when done:

```typescript
await program.removeEventListener(listenerId);
```

---

## See Also

- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — `initialize`, `mint`, `burn`, `freeze`, `thaw`, `getTotalSupply`
- [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) — `pause`, `unpause`, `updateMinter`, `revokeMinter`, `updateRoles`
- [SSS-3.md](./SSS-3.md) — SSS-3 reserve-backed preset specification
- [anchor-program-testing.md](./anchor-program-testing.md) — running the full test suite
