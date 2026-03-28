# SSS — Architecture

> Solana Stablecoin Standard (SSS) — a modular, production-ready SDK for issuing stablecoins on Solana using Token-2022.

---

## Overview

SSS is structured as three layers:

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
│   CLI · REST backend · custom frontend · integrations   │
├─────────────────────────────────────────────────────────┤
│                     SDK Layer                            │
│   SolanaStablecoin · ComplianceModule · TypeScript SDK  │
├─────────────────────────────────────────────────────────┤
│                  On-Chain Layer                          │
│   sss-token (Anchor) · sss-transfer-hook (Anchor)       │
│   Token-2022 · System Program                           │
└─────────────────────────────────────────────────────────┘
```

Each layer depends only on the layer below it. On-chain programs are the source of truth; the SDK wraps them; the application layer builds on the SDK.

---

## Layer 1 — On-Chain Programs

### `sss-token`
**Program ID:** `2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY`

The core stablecoin program. Manages the lifecycle of Token-2022 mints with a `StablecoinConfig` PDA that records preset, authorities, pause state, and minter caps.

**Instructions:** `initialize` · `mint` · `burn` · `freeze_account` · `thaw_account` · `pause` · `unpause` · `update_minter` · `revoke_minter` · `update_roles`

**Key accounts:**
- `StablecoinConfig` PDA — global per-mint config
- `MinterInfo` PDA — per-minter cap tracking

### `sss-transfer-hook`
**Program ID:** `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

SSS-2 only. Implements the Token-2022 Transfer Hook interface. Token-2022 calls this program on every token transfer. The hook checks both the sender and receiver against an on-chain `BlacklistState` PDA and rejects transfers involving blacklisted addresses.

**Instructions:** `transfer_hook` · `initialize_extra_account_meta_list` · `blacklist_add` · `blacklist_remove`

---

## Layer 2 — SDK

TypeScript SDK (`sdk/`) built on `@coral-xyz/anchor` and `@solana/spl-token`.

### `SolanaStablecoin`
Primary class. Provides `create()`, `mintTo()`, `burn()`, `pause()`, `unpause()`, `updateMinter()`, `revokeMinter()`, `getTotalSupply()`. Lazy-loads the Anchor IDL for `sss-token`.

### `ComplianceModule`
Compliance class for SSS-2 stablecoins. Wraps blacklist management (`initializeBlacklist`, `addToBlacklist`, `removeFromBlacklist`, `isBlacklisted`) and Token-2022 freeze/thaw.

### `AdminTimelockModule`
Governance time-lock for admin operations. Schedules and executes delayed authority changes.

### `BadDebtBackstopModule`
Insurance fund management for SSS-3 (reserve-backed). Covers CDP liquidation shortfalls. Methods: `contributeToBackstop`, `withdrawFromBackstop`, `triggerBadDebtSocialization`, `fetchBackstopFundState`, `computeCoverageRatio`. See [on-chain-sdk-backstop.md](./on-chain-sdk-backstop.md).

### `CdpModule`
Collateralized Debt Position management. Create, manage, and liquidate CDPs.

### `CircuitBreakerModule`
Automatic kill-switch when anomalous mint/burn velocity is detected.

### `CollateralConfigModule`
Register and configure collateral types: `registerCollateral`, `updateCollateralConfig`, `getCollateralConfig`, `isWhitelisted`. See [on-chain-sdk-authority-collateral.md](./on-chain-sdk-authority-collateral.md).

### `CpiModule`
Cross-Program Invocation helpers for composing with external Solana programs.

### `DaoCommitteeModule`
Multi-sig DAO committee governance for protocol parameter changes.

### `FeatureFlagsModule`
On-chain feature flag management for staged rollouts.

### `OracleParamsModule`
Oracle configuration and price feed management. See [on-chain-sdk-oracle-params.md](./on-chain-sdk-oracle-params.md).

### `ProofOfReserves`
Off-chain reserve attestation helpers and on-chain verification. See [PROOF-OF-RESERVES.md](./PROOF-OF-RESERVES.md).

### `SpendPolicyModule`
Per-address velocity limits and spend policy enforcement.

### `StabilityFeeModule`
Accrual and collection of stability fees on active CDPs. See [stability-fee.md](./stability-fee.md).

### `YieldCollateralModule`
Yield-bearing collateral integration (e.g., staked SOL, liquid staking tokens).

### `ZkComplianceModule`
Zero-knowledge compliance proofs for privacy-preserving KYC/AML checks.

### Config Helpers
`sss1Config(params)`, `sss2Config(params)`, and `sss3Config(params)` — typed preset builders that produce the correct `InitializeParams` for each preset.

---

## Layer 3 — Application Layer

### REST Backend (`backend/`)
Rust / axum HTTP server. Wraps SDK operations in authenticated REST endpoints. Manages API keys, rate limiting, audit logging, and webhook dispatch. See [api.md](./api.md) for endpoint reference.

### CLI (`sdk/cli/`)
`sss-cli` — command-line interface for all SDK operations. Suitable for scripting and devnet testing. See [sdk-cli.md](./sdk-cli.md).

---

## Preset Layer

SSS ships with two opinionated presets. A preset is a curated set of Token-2022 extensions + on-chain programs bundled into a single `initialize` call.

| Feature | SSS-1 Minimal | SSS-2 Compliant | SSS-3 Trustless |
|---------|:---:|:---:|:---:|
| Token-2022 mint | ✅ | ✅ | ✅ |
| Freeze authority | ✅ | ✅ | ✅ |
| Metadata extension | ✅ | ✅ | ✅ |
| Pause / unpause | ✅ | ✅ | ✅ |
| Minter caps | ✅ | ✅ | ✅ |
| Permanent delegate | ❌ | ✅ | ✅ |
| Transfer hook | ❌ | ✅ | ✅ |
| On-chain blacklist | ❌ | ✅ | ✅ |
| Collateral vault | ❌ | ❌ | ✅ |
| Collateral check (mint) | ❌ | ❌ | ✅ |
| Confidential transfers | ❌ | ❌ | ✅ |

See [SSS-1.md](./SSS-1.md), [SSS-2.md](./SSS-2.md), [SSS-3.md](./SSS-3.md) for full preset specifications.

---

## Data Flow — SSS-2 Token Transfer

```
User wallet
    │ Transfer instruction
    ▼
Token-2022 Program
    │ (sees transfer_hook extension on mint)
    │ CPI → sss-transfer-hook
    ▼
sss-transfer-hook
    │ read BlacklistState PDA
    ├─ sender blacklisted? → reject (SenderBlacklisted 6000)
    ├─ receiver blacklisted? → reject (ReceiverBlacklisted 6001)
    └─ ok → Token-2022 completes transfer
```

The blacklist check happens inside the same transaction as the transfer — not as a separate step. There is no off-chain component that can be bypassed.

---

## Data Flow — Mint

```
Minter wallet
    │ mint instruction (amount)
    ▼
sss-token program
    │ verify MinterInfo PDA exists
    │ verify minted + amount ≤ cap (if cap > 0)
    │ verify config.paused == false
    │ CPI → Token-2022 MintTo
    ▼
Recipient token account: balance + amount
StablecoinConfig.total_minted + amount
MinterInfo.minted + amount
```

---

## Program Derived Addresses

| PDA | Seeds | Program |
|-----|-------|---------|
| `StablecoinConfig` | `["stablecoin-config", mint]` | `sss-token` |
| `MinterInfo` | `["minter-info", config, minter]` | `sss-token` |
| `BlacklistState` | `["blacklist-state", mint]` | `sss-transfer-hook` |

---

## CI

All three CI jobs must pass on every PR:

| Job | What it checks |
|-----|---------------|
| TypeScript SDK | `npx tsc --noEmit` + `npx vitest run` (81 tests) |
| Backend (Rust / axum) | `cargo build` + `cargo test` + `cargo clippy` |
| Anchor Programs | `anchor build` + `anchor test` (13 tests, localnet) |
| SDK Integration Tests | Integration tests against localnet validator |

---

## Devnet Deployments

| Program | Program ID |
|---------|-----------|
| `sss-token` | `2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

See [devnet-deploy.md](./devnet-deploy.md) for the full deployment and verification flow.
