# @sss/sdk — Solana Stablecoin Standard SDK

TypeScript SDK for the Solana Stablecoin Standard (SSS) token program. Provides typed clients for all on-chain features: circuit breaker, spend policies, DAO governance, yield-bearing collateral, and ZK compliance.

## Installation

```sh
npm install @sss/sdk @coral-xyz/anchor @solana/web3.js
```

## Quick Start

```ts
import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import {
  SolanaStablecoin,
  CircuitBreakerModule,
  SpendPolicyModule,
  DaoCommitteeModule,
  YieldCollateralModule,
  ZkComplianceModule,
  SSS_TOKEN_PROGRAM_ID,
} from '@sss/sdk';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const provider = new AnchorProvider(connection, new Wallet(keypair), {});
```

---

## SDK Modules

### 1. CircuitBreakerModule (SSS-080 / bit 0)

Halt or resume all mint/burn operations for a stablecoin.

**Flag:** `FLAG_CIRCUIT_BREAKER_V2 = 1n << 0n` (0x01)

```ts
import { CircuitBreakerModule, FLAG_CIRCUIT_BREAKER_V2 } from '@sss/sdk';

const cb = new CircuitBreakerModule(provider, SSS_TOKEN_PROGRAM_ID);

// Halt operations
await cb.trigger({ mint });

// Check status
const { triggered, flags } = await cb.getState(mint);
console.log('Halted:', triggered);

// Resume operations
await cb.release({ mint });
```

| Method | Description |
|---|---|
| `getConfigPda(mint)` | Derive StablecoinConfig PDA |
| `trigger({ mint })` | Set circuit breaker (halt mint/burn) |
| `release({ mint })` | Clear circuit breaker (resume) |
| `isTriggered(mint)` | Read flag state (boolean) |
| `getState(mint)` | Get `{ triggered, flags }` |

---

### 2. SpendPolicyModule (SSS-062 / bit 1)

Enforce per-transfer token limits.

**Flag:** `FLAG_SPEND_POLICY = 1n << 1n` (0x02)

```ts
import { SpendPolicyModule, FLAG_SPEND_POLICY } from '@sss/sdk';

const sp = new SpendPolicyModule(provider, SSS_TOKEN_PROGRAM_ID);

// Set 1 000 USDS limit (6 decimals → 1_000_000_000 base units)
await sp.setSpendLimit({ mint, maxAmount: 1_000_000_000n });

// Check if active + read limit
const active = await sp.isActive(mint);
const limit = await sp.getMaxTransferAmount(mint);

// Remove limit
await sp.clearSpendLimit({ mint });
```

| Method | Description |
|---|---|
| `getConfigPda(mint)` | Derive StablecoinConfig PDA |
| `setSpendLimit({ mint, maxAmount })` | Enable policy + set limit |
| `clearSpendLimit({ mint })` | Disable policy + reset limit |
| `isActive(mint)` | Whether FLAG_SPEND_POLICY is set |
| `getMaxTransferAmount(mint)` | Read current limit (0n = unset) |

---

### 3. DaoCommitteeModule (SSS-068 / bit 2)

Multi-sig DAO committee governance for stablecoin configuration changes.

**Flag:** `FLAG_DAO_COMMITTEE = 1n << 2n` (0x04)

```ts
import { DaoCommitteeModule, FLAG_DAO_COMMITTEE } from '@sss/sdk';

const dao = new DaoCommitteeModule(provider, SSS_TOKEN_PROGRAM_ID);

// Raise a proposal to update a minter
await dao.proposeAction({
  mint,
  action: { kind: 'UpdateMinter', newMinter: newMinterKey },
});

// Members vote
await dao.voteOnProposal({ mint, proposalId: 0 });

// Execute when quorum reached
await dao.executeProposal({ mint, proposalId: 0 });

// Read proposal state
const proposal = await dao.getProposal(mint, 0);
```

| Method | Description |
|---|---|
| `getConfigPda(mint)` | Derive StablecoinConfig PDA |
| `getProposalPda(mint, proposalId)` | Derive ProposalPda |
| `initDaoCommittee(params)` | Initialize committee |
| `proposeAction(params)` | Raise a governance proposal |
| `voteOnProposal(params)` | Cast a committee vote |
| `executeProposal(params)` | Execute when quorum reached |
| `getProposal(mint, proposalId)` | Fetch proposal on-chain state |

---

### 4. YieldCollateralModule (SSS-070 / bit 3)

Accept yield-bearing tokens (stSOL, mSOL, etc.) as CDP collateral.

**Flag:** `FLAG_YIELD_COLLATERAL = 1n << 3n` (0x08)

> **Note:** Only valid for **SSS-3** (reserve-backed) stablecoins.

```ts
import { YieldCollateralModule, FLAG_YIELD_COLLATERAL } from '@sss/sdk';

const yc = new YieldCollateralModule(provider, SSS_TOKEN_PROGRAM_ID);

// Initialize with stSOL whitelisted (one-time per stablecoin)
await yc.initYieldCollateral({ mint, initialMints: [stSOLMint] });

// Add mSOL later
await yc.addCollateralMint({ mint, collateralMint: mSOLMint });

// Remove stSOL
await yc.removeCollateralMint({ mint, collateralMint: stSOLMint });

// Check whitelist
const whitelist = await yc.getWhitelistedMints(mint);
const active = await yc.isActive(mint);
```

| Method | Description |
|---|---|
| `getConfigPda(mint)` | Derive StablecoinConfig PDA |
| `getYieldCollateralConfigPda(mint)` | Derive YieldCollateralConfig PDA |
| `initYieldCollateral(params)` | Initialize + enable yield collateral |
| `addCollateralMint(params)` | Add mint to whitelist (max 10) |
| `removeCollateralMint(params)` | Remove mint from whitelist |
| `isActive(mint)` | Whether FLAG_YIELD_COLLATERAL is set |
| `getWhitelistedMints(mint)` | Fetch current whitelist |

---

### 5. ZkComplianceModule (SSS-075 / SSS-076 / bit 4)

Zero-knowledge proof compliance — requires transfer senders to hold a valid verification record.

**Flag:** `FLAG_ZK_COMPLIANCE = 1n << 4n` (0x10)

> **Note:** Only valid for **SSS-2** stablecoins.

```ts
import { ZkComplianceModule, FLAG_ZK_COMPLIANCE } from '@sss/sdk';

const zk = new ZkComplianceModule(provider, SSS_TOKEN_PROGRAM_ID);

// Initialize ZK compliance for a mint
await zk.initZkCompliance({ mint, ttlSlots: 1500 });

// Submit a ZK proof (creates/refreshes VerificationRecord PDA)
await zk.submitZkProof({ mint, user: userKey });

// Close an expired record
await zk.closeVerificationRecord({ mint, user: userKey });

// Check if active
const active = await zk.isActive(mint);
```

| Method | Description |
|---|---|
| `getConfigPda(mint)` | Derive StablecoinConfig PDA |
| `getZkComplianceConfigPda(mint)` | Derive ZkComplianceConfig PDA |
| `getVerificationRecordPda(mint, user)` | Derive VerificationRecord PDA |
| `initZkCompliance(params)` | Initialize ZK compliance + set TTL |
| `submitZkProof(params)` | Submit proof → create VerificationRecord |
| `closeVerificationRecord(params)` | Close expired record (reclaim rent) |
| `isActive(mint)` | Whether FLAG_ZK_COMPLIANCE is set |
| `getZkComplianceConfig(mint)` | Fetch ZkComplianceConfig account |
| `getVerificationRecord(mint, user)` | Fetch VerificationRecord account |

---

## Feature Flag Reference

| Flag | Constant | Bit | Value |
|---|---|---|---|
| Circuit Breaker | `FLAG_CIRCUIT_BREAKER_V2` | 0 | 0x01 |
| Spend Policy | `FLAG_SPEND_POLICY` | 1 | 0x02 |
| DAO Committee | `FLAG_DAO_COMMITTEE` | 2 | 0x04 |
| Yield Collateral | `FLAG_YIELD_COLLATERAL` | 3 | 0x08 |
| ZK Compliance | `FLAG_ZK_COMPLIANCE` | 4 | 0x10 |

> **Note:** `FeatureFlagsModule` also exports a legacy `FLAG_CIRCUIT_BREAKER = 1n << 7n` for backwards compatibility. Use `FLAG_CIRCUIT_BREAKER_V2` from `CircuitBreakerModule` for the correct on-chain bit.

---

## Other Exports

- **`SolanaStablecoin`** — core PDA derivation helpers (`getConfigPda`, `getMinterPda`)
- **`ComplianceModule`** — KYC/AML compliance address management
- **`ProofOfReserves`** — Merkle proof verification for reserve transparency
- **`FeatureFlagsModule`** — Generic feature flag set/clear/read (wraps `set_feature_flag` / `clear_feature_flag`)
- **`SSSClient`** — REST API client for the SSS backend
- **`SSSError`** — Typed error class for API + on-chain errors
- **Presets** — `SSS_PRESET_1`, `SSS_PRESET_2`, `SSS_PRESET_3` configuration objects

---

## Running Tests

```sh
npx vitest run          # unit tests (359 tests)
npx vitest run --reporter=verbose   # verbose output
```

---

## License

MIT
