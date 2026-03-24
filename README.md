# Solana Stablecoin Standard (SSS)

A modular, production-ready stablecoin SDK for Solana with two opinionated presets built on Token-2022.

## Presets

| Feature | SSS-1 Minimal | SSS-2 Compliant | SSS-3 Trustless |
|---------|:---:|:---:|:---:|
| Token-2022 mint | ✅ | ✅ | ✅ |
| Freeze authority | ✅ | ✅ | ✅ |
| Metadata extension | ✅ | ✅ | ✅ |
| Pause/unpause | ✅ | ✅ | ✅ |
| Minter caps | ✅ | ✅ | ✅ |
| Permanent delegate | ❌ | ✅ | ✅ |
| Transfer hook | ❌ | ✅ | ✅ |
| On-chain blacklist | ❌ | ✅ | ✅ |
| Collateral vault (no oracle) | ❌ | ❌ | ✅ |
| Confidential transfers (ZK) | ❌ | ❌ | ✅ |

**SSS-1** — For internal tokens, DAO treasuries, ecosystem settlement.  
**SSS-2** — For regulated stablecoins (USDC/USDT-class). Compliant by default.  
**SSS-3** — Trustless collateral-backed: on-chain collateral enforcement + ZK transfer privacy. [Reference design →](docs/SSS-3.md)

## Quick Start

### TypeScript SDK

```bash
npm install @stbr/sss-token
```

```ts
import { SolanaStablecoin, sss1Config, sss2Config } from '@stbr/sss-token';
import { AnchorProvider } from '@coral-xyz/anchor';

// SSS-1: Minimal stablecoin
const stablecoin = await SolanaStablecoin.create(provider, sss1Config({
  name: 'My Stable',
  symbol: 'MST',
}));

// SSS-2: Compliant stablecoin
const compliant = await SolanaStablecoin.create(provider, sss2Config({
  name: 'USD Stable',
  symbol: 'USDS',
  transferHookProgram: hookProgramId,
}));

// Mint tokens
await stablecoin.mintTo({
  mint: stablecoin.mint,
  amount: 1_000_000n,  // 1 USDS (6 decimals)
  recipient: recipientPubkey,
});

// Get supply
const supply = await stablecoin.getTotalSupply();
console.log(`Circulating: ${supply.circulatingSupply}`);
```

### Compliance (SSS-2)

```ts
import { ComplianceModule } from '@stbr/sss-token';

const compliance = new ComplianceModule(provider, mint, hookProgramId);

// Freeze an account
await compliance.freezeAccount(tokenAccount);

// Check blacklist
const blocked = await compliance.isBlacklisted(suspectAddress);
```

## Architecture

```
Layer 3: Presets
  ├── SSS-1 (Minimal)
  └── SSS-2 (Compliant)

Layer 2: Modules
  ├── Compliance (transfer hook, blacklist, permanent delegate)
  └── Privacy (confidential transfers — future)

Layer 1: Base SDK
  └── Token-2022 creation, role management, mint/burn
```

## Repository Structure

```
programs/sss-token/          # Anchor program — core stablecoin instructions
programs/transfer-hook/      # Transfer hook program — SSS-2 blacklist enforcement
sdk/                         # TypeScript SDK (@stbr/sss-token)
cli/                         # CLI tool (sss-token)
backend/                     # Rust/axum REST backend (mint tracking, compliance API)
tests/                       # Integration tests
docs/                        # Documentation
```

## Backend API

Start with Docker:

```bash
docker compose up -d
```

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/mint` | Record mint event |
| POST | `/api/burn` | Record burn event |
| GET | `/api/supply` | Get token supply |
| GET | `/api/events` | List mint/burn events |
| GET | `/api/compliance/blacklist` | List blacklisted addresses |
| POST | `/api/compliance/blacklist` | Add to blacklist |
| GET | `/api/compliance/audit` | Audit log |
| GET/POST | `/api/webhooks` | Manage webhooks |

## Advanced Features

| Feature | Description |
|---------|-------------|
| [Proof of Reserves](docs/PROOF-OF-RESERVES.md) | On-chain PoR PDA (SSS-123): submit attestations, verify reserve ratio, breach events, Kani proofs |
| [Reserve Composition](docs/RESERVE-REPORTING.md) | On-chain breakdown of backing asset types per mint (SSS-124): cash, T-bills, repo, other |
| [Redemption Guarantee at Par](docs/REDEMPTION-GUARANTEE.md) | On-chain 1:1 redemption with SLA enforcement (SSS-125): ~3 min SLA, 10% penalty from insurance fund on breach |
| [Travel Rule Compliance](docs/TRAVEL-RULE.md) | FATF Travel Rule (SSS-127): TravelRuleRecord PDA, VASP-to-VASP encrypted payloads, backend indexer + REST API |
| [Sanctions Oracle](docs/SANCTIONS-ORACLE.md) | Pluggable OFAC/sanctions screening (SSS-128): SanctionsRecord PDA, oracle registration, transfer hook enforcement, staleness window |
| [ZK Credentials](docs/ZK-CREDENTIALS.md) | Selective-disclosure ZK compliance proofs (SSS-129): CredentialRegistry + CredentialRecord PDAs, Groth16 proofs, not_sanctioned / kyc_passed / accredited_investor types, backend REST API |
| [Stability Fee PID](docs/STABILITY-FEE-PID.md) | Automatic peg-stabilisation via PID controller (SSS-130): PidConfig PDA, permissionless keeper updates, anti-windup integral clamp, PidConfigInitialised + PidFeeUpdated events |
| [Oracle Abstraction](docs/ORACLE-ABSTRACTION.md) | Pluggable oracle layer (SSS-119): Pyth / Switchboard / Custom adapters, CustomPriceFeed PDA, set_oracle_config + update_custom_price instructions, config schema versioning |
| [Authority Rotation](docs/AUTHORITY-ROTATION.md) | Time-locked config authority rotation (SSS-120): 48-hr timelock, 7-day backup recovery window, AuthorityRotationRequest PDA, 4 instructions, 4 events |

## Documentation

| Guide | Description |
|-------|-------------|
| [API Reference](docs/api.md) | Full REST API reference for all backend endpoints |
| [Authentication](docs/authentication.md) | API key creation and management |
| [SDK & CLI](docs/sdk-cli.md) | TypeScript SDK and `sss-token` CLI usage |
| [Rate Limiting](docs/rate-limiting.md) | Token-bucket rate limiter configuration and `Retry-After` behaviour |
| [Webhooks](docs/api.md#webhooks) | Event-driven webhook delivery for mint/burn events |
| [Compliance & Audit Log](docs/compliance-audit-log.md) | Blacklist management and audit log query API (SSS-014) |
| [On-Chain SDK: Core Methods](docs/on-chain-sdk-core.md) | `SolanaStablecoin` class — create, load, mintTo, burnFrom, freeze/thaw, supply query |
| [ComplianceModule](docs/compliance-module.md) | `ComplianceModule` SDK — blacklist management (addToBlacklist, removeFromBlacklist, isBlacklisted) + freeze/thaw |
| [Transfer Hook Program](docs/transfer-hook.md) | On-chain blacklist enforcement via Token-2022 transfer hook (SSS-2) |
| [Preset: SSS-1 Minimal](docs/SSS-1.md) | SSS-1 preset specification |
| [Preset: SSS-2 Compliant](docs/SSS-2.md) | SSS-2 preset specification |
| [Preset: SSS-3 Trustless](docs/SSS-3.md) | SSS-3 trustless collateral-backed reference design |
| [Architecture](docs/ARCHITECTURE.md) | Three-layer system architecture |
| [Submission](docs/SUBMISSION.md) | Bounty submission — what was built, how to run, what makes it innovative |
| [Devnet Deployment](docs/devnet-deploy.md) | Deploying and smoke-testing on Solana devnet |
| [Integration Testing](docs/integration-testing.md) | Running the full integration test suite and CI setup |
| [Anchor Program Tests](docs/anchor-program-testing.md) | Running the Anchor on-chain test suite locally and in CI (SSS-015) |
| [Formal Verification](docs/formal-verification.md) | Kani mathematical proofs — 7/7 invariants verified for all possible inputs |
| [On-Chain SDK: PBS + APC](docs/on-chain-sdk-pbs-apc.md) | `ProbabilisticModule` (PBS vaults, commitProbabilistic, proveAndResolve) + `AgentPaymentChannelModule` (APC open/settle/dispute) |
| [Proof Demo: Agent-to-Agent Task Payment](docs/PROOF-DEMO.md) | End-to-end runnable demo — two autonomous agents completing a verifiable task payment using APC + PBS on devnet (SSS-112) |
| [Event Schema v1](docs/EVENT-SCHEMA.md) | Canonical on-chain event schema — 13 event types, discriminators, envelope format, HMAC signing (SSS-142) |
| [Indexer Integration Guide](docs/INDEXER-GUIDE.md) | Helius, Shyft, Triton, and custom indexer setup — webhook registration, signature verification, TypeScript examples (SSS-142) |

## Judging Criteria

- **SDK Design & Modularity**: Layer-based architecture, clean preset API
- **Completeness**: SSS-1 + SSS-2 both implemented
- **Code Quality**: Anchor constraints, safe math, comprehensive errors
- **Security**: Freeze authority, blacklist, minter caps, pause mechanism
- **Solana Expertise**: Token-2022 extensions, PDAs, transfer hooks
- **Usability**: TypeScript SDK + CLI + REST API + Docker

## License

Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for attribution requirements and commercial licensing.

Contributing: see [CONTRIBUTING.md](./CONTRIBUTING.md).
