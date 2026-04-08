<p align="center">
  <img src="https://img.shields.io/badge/npm-@stbr/sss--token-CB3837?style=for-the-badge&logo=npm&logoColor=white" alt="npm" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Solana-Token--2022-9945FF?style=for-the-badge&logo=solana&logoColor=white" alt="Solana" />
</p>

# @stbr/sss-token

**TypeScript SDK for the Solana Stablecoin Standard.**

Typed clients for all on-chain features: minting, compliance, CDPs, oracles, circuit breakers, DAO governance, ZK compliance, and more. Works with all three SSS presets.

---

## Installation

```bash
npm install @stbr/sss-token @coral-xyz/anchor @solana/web3.js
```

---

## Quick Start

```ts
import { SolanaStablecoin, sss1Config, sss2Config } from '@stbr/sss-token';
import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';

const connection = new Connection('https://api.devnet.solana.com');
const provider = new AnchorProvider(connection, new Wallet(keypair), {});

// Create an SSS-1 stablecoin
const coin = await SolanaStablecoin.create(provider, sss1Config({
  name: 'My Dollar',
  symbol: 'MYD',
}));

// Mint tokens
await coin.mintTo({
  mint: coin.mint,
  amount: 1_000_000n,  // 1 MYD (6 decimals)
  recipient: wallet.publicKey,
});

// Check supply
const supply = await coin.getTotalSupply();
```

---

## SDK Modules

### Core

| Module | Description |
|---|---|
| `SolanaStablecoin` | Main entry point — create, load, mint, burn, freeze, thaw, supply queries |
| `ComplianceModule` | Blacklist management, freeze/thaw, KYC/AML address controls |
| `FeatureFlagsModule` | Generic feature flag set/clear/read operations |
| `ProofOfReserves` | Merkle proof verification for reserve transparency |

### Feature Modules

#### CircuitBreakerModule (bit 0)

Halt or resume all mint/burn operations instantly.

```ts
import { CircuitBreakerModule } from '@stbr/sss-token';

const cb = new CircuitBreakerModule(provider, programId);
await cb.trigger({ mint });      // Halt operations
await cb.release({ mint });      // Resume operations
const halted = await cb.isTriggered(mint);
```

| Method | Description |
|---|---|
| `trigger({ mint })` | Halt all mint/burn |
| `release({ mint })` | Resume operations |
| `isTriggered(mint)` | Check halt status |
| `getState(mint)` | Get `{ triggered, flags }` |

---

#### SpendPolicyModule (bit 1)

Enforce per-transfer token limits.

```ts
import { SpendPolicyModule } from '@stbr/sss-token';

const sp = new SpendPolicyModule(provider, programId);
await sp.setSpendLimit({ mint, maxAmount: 1_000_000_000n }); // 1000 USDS
await sp.clearSpendLimit({ mint });
```

| Method | Description |
|---|---|
| `setSpendLimit({ mint, maxAmount })` | Enable + set limit |
| `clearSpendLimit({ mint })` | Disable + reset |
| `isActive(mint)` | Check if policy is active |
| `getMaxTransferAmount(mint)` | Read current limit |

---

#### DaoCommitteeModule (bit 2)

Multi-sig DAO governance for configuration changes.

```ts
import { DaoCommitteeModule } from '@stbr/sss-token';

const dao = new DaoCommitteeModule(provider, programId);
await dao.proposeAction({ mint, action: { kind: 'UpdateMinter', newMinter } });
await dao.voteOnProposal({ mint, proposalId: 0 });
await dao.executeProposal({ mint, proposalId: 0 });
```

| Method | Description |
|---|---|
| `initDaoCommittee(params)` | Initialize committee |
| `proposeAction(params)` | Create governance proposal |
| `voteOnProposal(params)` | Cast committee vote |
| `executeProposal(params)` | Execute when quorum reached |
| `getProposal(mint, id)` | Fetch proposal state |

---

#### YieldCollateralModule (bit 3)

Accept yield-bearing tokens (stSOL, mSOL) as CDP collateral. SSS-3 only.

```ts
import { YieldCollateralModule } from '@stbr/sss-token';

const yc = new YieldCollateralModule(provider, programId);
await yc.initYieldCollateral({ mint, initialMints: [stSOLMint] });
await yc.addCollateralMint({ mint, collateralMint: mSOLMint });
```

| Method | Description |
|---|---|
| `initYieldCollateral(params)` | Initialize + enable |
| `addCollateralMint(params)` | Add to whitelist (max 10) |
| `removeCollateralMint(params)` | Remove from whitelist |
| `getWhitelistedMints(mint)` | Fetch current whitelist |

---

#### ZkComplianceModule (bit 4)

Zero-knowledge proof compliance — requires senders to hold valid verification records.

```ts
import { ZkComplianceModule } from '@stbr/sss-token';

const zk = new ZkComplianceModule(provider, programId);
await zk.initZkCompliance({ mint, ttlSlots: 1500 });
await zk.submitZkProof({ mint, user: userKey });
```

| Method | Description |
|---|---|
| `initZkCompliance(params)` | Initialize + set TTL |
| `submitZkProof(params)` | Submit proof, create record |
| `closeVerificationRecord(params)` | Close expired record |
| `getVerificationRecord(mint, user)` | Fetch record |

---

### Additional Modules

| Module | Description |
|---|---|
| `AdminTimelockModule` | Time-delayed admin operations |
| `GuardianModule` | Emergency pause/unpause multisig |
| `OracleParamsModule` | Oracle configuration and price feeds |
| `MultiOracleModule` | Median/TWAP across multiple oracle sources |
| `CdpModule` | Collateralized debt position management |
| `RedemptionQueueModule` | FIFO slot-delayed redemption |
| `InsuranceVaultModule` | Protocol insurance vault |
| `MarketMakerModule` | Registered market maker management |
| `LegalEntityModule` | On-chain issuer identity registry |
| `BridgeModule` | Cross-chain bridge operations |
| `SecurityHardeningModule` | Squads multisig + upgrade authority guards |
| `ConfidentialTransferModule` | ZK confidential transfers |
| `CustomOracleModule` | Custom oracle feed registration |
| `KeeperModule` | Authorized keeper management |
| `CpiModule` | Cross-program invocation helpers |

---

## Feature Flag Reference

| Flag | Constant | Bit | Value |
|---|---|---|---|
| Circuit Breaker | `FLAG_CIRCUIT_BREAKER_V2` | 0 | `0x01` |
| Spend Policy | `FLAG_SPEND_POLICY` | 1 | `0x02` |
| DAO Committee | `FLAG_DAO_COMMITTEE` | 2 | `0x04` |
| Yield Collateral | `FLAG_YIELD_COLLATERAL` | 3 | `0x08` |
| ZK Compliance | `FLAG_ZK_COMPLIANCE` | 4 | `0x10` |
| Redemption Queue | `FLAG_REDEMPTION_QUEUE` | 23 | `0x800000` |
| Legal Entity | `FLAG_LEGAL_REGISTRY` | 24 | `0x1000000` |

---

## Presets

```ts
import { SSS_PRESET_1, SSS_PRESET_2, SSS_PRESET_3 } from '@stbr/sss-token';
```

| Preset | Use Case |
|---|---|
| `SSS_PRESET_1` / `sss1Config()` | Internal tokens, DAO treasuries |
| `SSS_PRESET_2` / `sss2Config()` | Regulated stablecoins (USDC-class) |
| `SSS_PRESET_3` | Trust-minimized collateral-backed |

---

## API Client

The SDK includes a REST client for the SSS backend:

```ts
import { SSSClient } from '@stbr/sss-token';

const client = new SSSClient('http://localhost:3000', apiKey);
const supply = await client.getSupply();
const events = await client.getEvents({ limit: 50 });
```

---

## Testing

```bash
# Unit tests
npx vitest run

# Integration tests (requires running backend)
npx vitest run --config vitest.integration.config.ts

# Anchor localnet tests (requires validator)
npx vitest run --config vitest.anchor.config.ts

# Single file
npx vitest run src/SolanaStablecoin.test.ts
```

---

## License

Apache 2.0
