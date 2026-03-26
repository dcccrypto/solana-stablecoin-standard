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
| [Proof of Reserves](docs/PROOF-OF-RESERVES.md) | Cryptographic supply commitments — fetch, verify, and manually reproduce Merkle proofs |
| [Trust Model](docs/TRUST-MODEL.md) | Real trust assumptions per SSS tier — what is/isn't trustless in v1; v1 stubs and mitigations |
| [Insurance Vault](docs/INSURANCE-VAULT.md) | First-loss on-chain reserve for liquidation cascades — setup, seeding, draws, mint gate, replenishment runbook (SSS-151) |

## Documentation

| Guide | Description |
|-------|-------------|
| [API Reference](docs/api.md) | Full REST API reference for all backend endpoints |
| [Authentication](docs/authentication.md) | API key creation, management, and admin role separation (BUG-033) |
| [DAO Governance](docs/DAO-GOVERNANCE.md) | DAO committee proposal lifecycle, member-proposable governance, FLAG_DAO_COMMITTEE protection (BUG-011) |
| [SDK & CLI](docs/sdk-cli.md) | TypeScript SDK and `sss-token` CLI usage |
| [Python SDK](docs/PYTHON-SDK.md) | `SSSClient` async Python library + `sss-cli` — supply, reserves, CDPs, events, pandas analytics (SSS-144) |
| [Rate Limiting](docs/rate-limiting.md) | Token-bucket rate limiter configuration and `Retry-After` behaviour |
| [Webhooks](docs/api.md#webhooks) | Event-driven webhook delivery for mint/burn events |
| [Compliance & Audit Log](docs/compliance-audit-log.md) | Blacklist management and audit log query API (SSS-014) |
| [On-Chain SDK: Core Methods](docs/on-chain-sdk-core.md) | `SolanaStablecoin` class — create, load, mintTo, burnFrom, freeze/thaw, supply query |
| [ComplianceModule](docs/compliance-module.md) | `ComplianceModule` SDK — blacklist management (addToBlacklist, removeFromBlacklist, isBlacklisted) + freeze/thaw |
| [Transfer Hook Program](docs/transfer-hook.md) | On-chain blacklist enforcement via Token-2022 transfer hook (SSS-2) |
| [Preset: SSS-1 Minimal](docs/SSS-1.md) | SSS-1 preset specification |
| [Preset: SSS-2 Compliant](docs/SSS-2.md) | SSS-2 preset specification |
| [Preset: SSS-3 Trustless](docs/SSS-3.md) | SSS-3 trustless collateral-backed reference design |
| [Preset: SSS-4 Institutional](docs/SSS-4-INSTITUTIONAL.md) | SSS-4 Squads V4 multisig authority — institutional grade m-of-n governance (SSS-134) |
| [Upgrade Authority Guard](docs/UPGRADE-AUTHORITY-GUARD.md) | BPF upgrade authority transfer to Squads multisig + on-chain guard for continuous drift monitoring (SSS-150) |
| [Architecture](docs/ARCHITECTURE.md) | Three-layer system architecture |
| [Devnet Deployment](docs/devnet-deploy.md) | Deploying and smoke-testing on Solana devnet |
| [Deployment Wizard](scripts/deploy-wizard.ts) | Interactive 10-step deployment wizard (`npm run wizard`) — guided safe initialization with footgun protections, dry-run, and deploy manifest (SSS-155) |
| [Deployment Checker](scripts/check-deployment.ts) | Post-deploy validation script (`npm run check-deployment`) — verifies program, mint, PDAs, Squads multisig (SSS-155) |
| [GENIUS Act Compliance Checker](scripts/check-genius-compliance.ts) | CLI: `check-genius-compliance --mint <PUBKEY>` — verifies GENIUS Act required flags and configuration (SSS-148) |
| [Liquidity Stress Test](scripts/liquidity-stress-test.ts) | CLI: `liquidity-stress-test --tvl <USD> --scenarios` — MiCA Art. 45 redemption rush simulation with NCA-ready JSON output (SSS-149) |
| [Integration Testing](docs/integration-testing.md) | Running the full integration test suite and CI setup |
| [Anchor Program Tests](docs/anchor-program-testing.md) | Running the Anchor on-chain test suite locally and in CI (SSS-015) |
| [Formal Verification](docs/formal-verification.md) | Kani mathematical proofs — 7/7 invariants verified for all possible inputs |
| [On-Chain SDK: PBS + APC](docs/on-chain-sdk-pbs-apc.md) | `ProbabilisticModule` (PBS vaults, commitProbabilistic, proveAndResolve) + `AgentPaymentChannelModule` (APC open/settle/dispute) |
| [Proof Demo: Agent-to-Agent Task Payment](docs/PROOF-DEMO.md) | End-to-end runnable demo — two autonomous agents completing a verifiable task payment using APC + PBS on devnet (SSS-112) |
| [Event Schema v1](docs/EVENT-SCHEMA.md) | Canonical on-chain event schema — 13 event types, discriminators, envelope format, HMAC signing (SSS-142) |
| [Indexer Integration Guide](docs/INDEXER-GUIDE.md) | Helius, Shyft, Triton, and custom indexer setup — webhook registration, signature verification, TypeScript examples (SSS-142) |

## License

Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for attribution requirements and commercial licensing.

Contributing: see [CONTRIBUTING.md](./CONTRIBUTING.md).
