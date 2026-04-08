<p align="center">
  <img src="https://img.shields.io/badge/Solana-Token--2022-9945FF?style=for-the-badge&logo=solana&logoColor=white" alt="Solana Token-2022" />
  <img src="https://img.shields.io/badge/Anchor-0.32-blue?style=for-the-badge" alt="Anchor 0.32" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?style=for-the-badge&logo=rust&logoColor=white" alt="Rust 2021" />
  <img src="https://img.shields.io/badge/TypeScript-SDK-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript SDK" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=for-the-badge" alt="License" />
</p>

# Solana Stablecoin Standard (SSS)

**The modular, production-ready stablecoin framework for Solana.**

Build, deploy, and manage stablecoins on Solana with battle-tested presets, a full TypeScript SDK, Rust CPI crate, REST API backend, and 60+ on-chain instructions — all built on Token-2022.

> Created by [Khubair](https://github.com/dcccrypto)

---

## Why SSS?

Building a stablecoin on Solana means wrangling Token-2022 extensions, compliance infrastructure, oracle integrations, CDP mechanics, and governance tooling. SSS packages all of this into **three opinionated presets** so you can go from zero to production with a single SDK call.

- **Modular architecture** — Use only what you need. Every feature is a composable module.
- **Compliance-first** — On-chain blacklists, transfer hooks, KYC/AML, travel rule, legal entity registry.
- **Formally verified** — 75 Kani mathematical proofs covering all critical state transitions.
- **Production-ready** — Devnet-deployed, chaos-tested, with deployment wizard and post-deploy validation.

---

## Presets

| Feature | SSS-1 Minimal | SSS-2 Compliant | SSS-3 Trust-Minimized |
|---|:---:|:---:|:---:|
| Token-2022 mint | &#10003; | &#10003; | &#10003; |
| Freeze authority | &#10003; | &#10003; | &#10003; |
| Metadata extension | &#10003; | &#10003; | &#10003; |
| Pause / unpause | &#10003; | &#10003; | &#10003; |
| Minter caps | &#10003; | &#10003; | &#10003; |
| Permanent delegate | | &#10003; | &#10003; |
| Transfer hook (blacklist) | | &#10003; | &#10003; |
| On-chain blacklist | | &#10003; | &#10003; |
| Collateral vault + CDP | | | &#10003; |
| Multi-oracle consensus | | | &#10003; |
| Confidential transfers (ZK) | | | &#10003; |
| Mandatory Squads multisig | | | &#10003; |
| Immutable supply cap | | | &#10003; |
| DAO governance | | | &#10003; |

**SSS-1** — Internal tokens, DAO treasuries, ecosystem settlement.
**SSS-2** — Regulated stablecoins (USDC/USDT-class). Compliant by default.
**SSS-3** — Trust-minimized collateral-backed with on-chain enforcement, ZK privacy, mandatory Squads multisig, immutable supply cap, and oracle timelocks.

---

## Quick Start

### Install the SDK

```bash
npm install @stbr/sss-token
```

### Create a Stablecoin

```ts
import { SolanaStablecoin, sss1Config, sss2Config } from '@stbr/sss-token';
import { AnchorProvider } from '@coral-xyz/anchor';

// SSS-1: Minimal stablecoin
const stablecoin = await SolanaStablecoin.create(provider, sss1Config({
  name: 'My Stable',
  symbol: 'MST',
}));

// SSS-2: Compliant stablecoin with transfer hook
const compliant = await SolanaStablecoin.create(provider, sss2Config({
  name: 'USD Stable',
  symbol: 'USDS',
  transferHookProgram: hookProgramId,
}));
```

### Mint Tokens

```ts
await stablecoin.mintTo({
  mint: stablecoin.mint,
  amount: 1_000_000n, // 1 USDS (6 decimals)
  recipient: recipientPubkey,
});

const supply = await stablecoin.getTotalSupply();
console.log(`Circulating: ${supply.circulatingSupply}`);
```

### Compliance (SSS-2)

```ts
import { ComplianceModule } from '@stbr/sss-token';

const compliance = new ComplianceModule(provider, mint, hookProgramId);
await compliance.freezeAccount(tokenAccount);

const blocked = await compliance.isBlacklisted(suspectAddress);
```

---

## Repository Structure

```
solana-stablecoin-standard/
+-- programs/
|   +-- sss-token/             # Core Anchor program (60+ instructions)
|   +-- transfer-hook/         # Token-2022 transfer hook for blacklist enforcement
|   +-- cpi-caller/            # Test program for CPI composability
+-- crates/
|   +-- sss-cpi/               # Rust CPI client crate for external program integration
+-- sdk/                       # TypeScript SDK (@stbr/sss-token)
+-- sdk-python/                # Python SDK (async client + CLI)
+-- cli/                       # CLI tool (sss-token)
+-- backend/                   # Rust/axum REST API (mint tracking, compliance, webhooks)
+-- tests/                     # Integration, chaos, and spike test suites
+-- docs/                      # 100+ documentation files
+-- scripts/                   # Deployment wizard, smoke tests, validators
+-- specs/                     # Formal specifications
```

---

## Architecture

```
+---------------------------------------------------------+
|  Layer 3: Presets                                       |
|  sss1Config() | sss2Config() | sss3Config()            |
+---------------------------------------------------------+
        |
+---------------------------------------------------------+
|  Layer 2: Feature Modules                               |
|  Compliance | CDP | Oracle | Guardian | DAO | ZK        |
|  CircuitBreaker | SpendPolicy | YieldCollateral | ...   |
+---------------------------------------------------------+
        |
+---------------------------------------------------------+
|  Layer 1: Base SDK (SolanaStablecoin)                   |
|  Token-2022 creation | Role management | Mint/Burn      |
+---------------------------------------------------------+
        |
+---------------------------------------------------------+
|  On-Chain: sss-token program (Anchor/Rust)              |
|  60+ instructions | 23 PDA types | 75 Kani proofs      |
+---------------------------------------------------------+
```

---

## On-Chain Programs

| Program | ID (Devnet) | Description |
|---|---|---|
| `sss-token` | `ApQTVMKdtUUrGXgL6Hhzt9W2JFyLt6vGnHuimcdXe811` | Core stablecoin program |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` | Blacklist enforcement hook |
| `cpi-caller` | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` | CPI composability tests |

---

## Feature Modules

| Module | Flag Bit | Description |
|---|---|---|
| CircuitBreaker | 0 | Halt/resume all mint/burn operations |
| SpendPolicy | 1 | Per-transfer token limits |
| DaoCommittee | 2 | Multi-sig governance proposals |
| YieldCollateral | 3 | Yield-bearing token CDP support |
| ZkCompliance | 4 | Zero-knowledge proof verification |
| RedemptionQueue | 23 | FIFO slot-delayed redemption with MEV protection |
| LegalEntity | 24 | On-chain issuer identity registry |
| Compliance | - | Transfer hook blacklist + freeze/thaw |
| Guardian | - | Emergency pause/unpause multisig |
| AdminTimelock | - | Time-delayed admin operations |
| MultiOracle | - | Median/TWAP across 5 oracle sources |
| ProofOfReserves | - | Cryptographic supply commitments |

---

## Backend API

The Rust/axum backend provides REST endpoints for off-chain tracking and compliance.

```bash
# Start with Docker
docker compose -f backend/docker-compose.yml up -d

# Or build from source
cd backend && cargo run --release
```

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/mint` | Record mint event |
| `POST` | `/api/burn` | Record burn event |
| `GET` | `/api/supply` | Token supply stats |
| `GET` | `/api/events` | Mint/burn event log |
| `GET/POST` | `/api/compliance/blacklist` | Blacklist management |
| `GET` | `/api/compliance/audit` | Compliance audit log |
| `GET/POST` | `/api/webhooks` | Webhook subscriptions |
| `WS` | `/ws/events` | Real-time event stream |

---

## Build & Test

### On-Chain Programs

```bash
anchor build                        # Build all programs
anchor test                         # Build + localnet + integration tests
anchor test --skip-build            # Reuse existing artifacts
cargo clippy -- -D warnings         # Lint (CI enforces zero warnings)
```

### TypeScript SDK

```bash
cd sdk && npm install
npx tsc --noEmit                    # Type check
npx vitest run                      # Unit tests
npx vitest run --config vitest.integration.config.ts   # Integration tests
npx vitest run --config vitest.anchor.config.ts        # Anchor localnet tests
```

### Backend

```bash
cd backend && cargo build --release
cargo test                          # Unit tests
cargo clippy -- -D warnings         # Lint
```

### Root Shortcuts

```bash
npm run build              # Build SDK + CLI
npm run test               # Full anchor test suite
npm run test:sdk           # SDK vitest
npm run test:backend       # Backend cargo test
npm run lint               # SDK eslint
```

---

## Deployment

```bash
# Interactive deployment wizard (recommended)
npm run wizard

# Manual devnet deploy
npm run deploy:devnet

# Post-deploy validation
npm run check-deployment

# Devnet smoke test
npm run smoke:devnet
```

See [Deployment Guide](docs/DEPLOYMENT-GUIDE.md) and [Devnet Deployment](docs/devnet-deploy.md) for details.

---

## SSS-3 Trust Assumptions

SSS-3 is **trust-minimized**, not trustless. After SSS-147 hardening, the remaining trust assumptions are documented and on-chain verifiable:

| Assumption | On-chain verifiable? | Hardening |
|---|---|---|
| Reserve attestor is authority-whitelisted | Yes | v1 — future versions move to direct vault reads |
| Pyth oracle feed is authority-set | Yes (timelocked) | SSS-147D: `require_timelock_executed()` |
| Guardian multisig provides emergency controls | Yes | Always required for pause/unpause |
| Squads multisig holds upgrade authority | Yes (mandatory) | SSS-147A: `initialize` rejects without valid multisig |

SSS-147 also enforces: immutable `max_supply` (SSS-147B), DAO-member-proposable governance (SSS-147C), and compliance authority timelocks (SSS-147D).

---

## Documentation

### Core Guides

| Guide | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Three-layer system architecture |
| [Formal Spec](docs/FORMAL-SPEC.md) | Formal program specification |
| [Trust Model](docs/TRUST-MODEL.md) | Trust assumptions per SSS tier |
| [Security](docs/SECURITY.md) | Security model, threat analysis, audit findings |
| [Formal Verification](docs/formal-verification.md) | 75 Kani mathematical proofs |

### SDK & API

| Guide | Description |
|---|---|
| [SDK & CLI Reference](docs/sdk-cli.md) | TypeScript SDK and CLI usage |
| [Python SDK](docs/PYTHON-SDK.md) | Async Python client + analytics |
| [API Reference](docs/api.md) | Full REST API documentation |
| [Authentication](docs/authentication.md) | API key management |
| [Event Schema](docs/EVENT-SCHEMA.md) | 13 on-chain event types |

### Presets & Features

| Guide | Description |
|---|---|
| [SSS-1 Minimal](docs/SSS-1.md) | Minimal preset specification |
| [SSS-2 Compliant](docs/SSS-2.md) | Compliant preset specification |
| [SSS-3 Trust-Minimized](docs/SSS-3.md) | Collateral-backed reference design |
| [SSS-4 Institutional](docs/SSS-4-INSTITUTIONAL.md) | Squads V4 institutional governance |
| [Multi-Oracle Consensus](docs/MULTI-ORACLE-CONSENSUS.md) | Median/TWAP price aggregation |
| [Redemption Queue](docs/REDEMPTION-QUEUE.md) | FIFO slot-delayed redemption |
| [Proof of Reserves](docs/PROOF-OF-RESERVES.md) | Cryptographic supply commitments |
| [DAO Governance](docs/DAO-GOVERNANCE.md) | Committee proposal lifecycle |
| [Transfer Hook](docs/transfer-hook.md) | On-chain blacklist enforcement |
| [Legal Entity Registry](docs/LEGAL-ENTITY-REGISTRY.md) | On-chain issuer identity |

### Operations

| Guide | Description |
|---|---|
| [Deployment Guide](docs/DEPLOYMENT-GUIDE.md) | Production deployment |
| [Devnet Deployment](docs/devnet-deploy.md) | Devnet deploy + smoke test |
| [Mainnet Checklist](docs/MAINNET-CHECKLIST.md) | Pre-mainnet validation |
| [GENIUS Act Compliance](docs/GENIUS-ACT-COMPLIANCE.md) | Regulatory compliance checker |
| [Indexer Guide](docs/INDEXER-GUIDE.md) | Helius, Shyft, Triton integration |
| [Integration Testing](docs/integration-testing.md) | Full test suite setup |

---

## CI/CD

GitHub Actions runs four parallel jobs on every push:

| Job | What it checks |
|---|---|
| `backend` | `cargo build` + `cargo clippy` + `cargo test` |
| `sdk` | `tsc --noEmit` + `vitest run` |
| `anchor` | `anchor build` + `anchor test` |
| `sdk-integration` | Backend + SDK integration tests |

Toolchain: Solana 2.3.13 / Anchor 0.32.0 / Node 20 / Rust 2021

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

Key rules:
- All arithmetic uses `checked_*` operations (no raw `+`, `-`, `*`, `/`)
- New instructions require Kani proofs in `proofs.rs`
- New SDK methods require vitest tests
- `overflow-checks = true` is enforced in release builds

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for attribution and commercial licensing.
