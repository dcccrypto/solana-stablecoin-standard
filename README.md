# Solana Stablecoin Standard (SSS)

A complete, production-grade toolkit for deploying and managing stablecoins on Solana using Token-2022 extensions.

The project defines two compliance presets — **SSS-1** (minimal) and **SSS-2** (compliant with blacklist enforcement) — and provides everything needed to go from zero to a fully operational stablecoin: a CLI for operators, a TypeScript SDK for integrators, a REST backend for infrastructure, an on-chain Anchor program for transfer-hook compliance, and a React demo that ties it all together.

## Repository Structure

```
solana-stablecoin-standard/
├── cli/                        Command-line interface for deploying & managing stablecoins
├── sdk/                        TypeScript SDK wrapping all on-chain operations
├── backend/                    REST API service (mint/burn lifecycle, webhooks, event listener)
├── transfer_hooks/blacklist/   Anchor program — transfer-hook blacklist (SSS-2)
├── demo/                       React + Phantom wallet demo app
└── docs/                       Full documentation
```

## Standards

| Standard | What it provides | Token-2022 Extensions |
|----------|-----------------|----------------------|
| **SSS-1** | Minimal stablecoin — mint/burn, freeze, on-mint metadata | Metadata Pointer |
| **SSS-2** | SSS-1 + compliance — blacklist enforcement via transfer hook | Metadata Pointer, Transfer Hook |

See [docs/SSS-1.md](docs/SSS-1.md) and [docs/SSS-2.md](docs/SSS-2.md) for the full specifications.

## Quick Start

### 1. Deploy a stablecoin (CLI)

```bash
cd cli && npm install && npm run build

# Generate a starter config
npx sss-token init --preset sss-1

# Edit sss-token.config.toml (set authorities, name, symbol)
# Then deploy
npx sss-token init --custom sss-token.config.toml

# Mint tokens
npx sss-token mint <recipient-wallet> 1000000
```

### 2. Integrate programmatically (SDK)

```typescript
import { SolanaStablecoin, Presets } from "sss-token-sdk";

const stable = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_1,
  name: "My Dollar",
  symbol: "MUSD",
  decimals: 6,
  authority: adminKeypair,
});

await stable.mintTokens({ recipient: walletPubkey, amount: 1_000_000n, minter: adminKeypair });
const supply = await stable.getSupply();
```

### 3. Run the backend

```bash
cd backend && npm install
cp .env.example .env
# Edit .env with your mint address and keypair
npm run dev
```

### 4. Launch the demo

```bash
cd demo && npm install
npm run dev
# Open http://localhost:5173, connect Phantom, enter your mint address in Settings
```

## Documentation

| Document | Contents |
|----------|----------|
| [docs/README.md](docs/README.md) | Overview, quick start, preset comparison, architecture diagram |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layer model, data flows, security model |
| [docs/SDK.md](docs/SDK.md) | Presets, custom configs, TypeScript examples |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Operator runbook (mint, freeze, blacklist, etc.) |
| [docs/SSS-1.md](docs/SSS-1.md) | Minimal stablecoin standard specification |
| [docs/SSS-2.md](docs/SSS-2.md) | Compliant stablecoin standard specification |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | Regulatory considerations, audit trail format |
| [docs/API.md](docs/API.md) | Backend REST API reference |

Each component also has its own README:

- [cli/README.md](cli/README.md) — CLI usage and config reference
- [sdk/README.md](sdk/README.md) — SDK API and examples
- [backend/README.md](backend/README.md) — Backend setup and endpoints
- [transfer_hooks/blacklist/README.md](transfer_hooks/blacklist/README.md) — Anchor program architecture

## Tech Stack

- **On-chain**: Solana, Token-2022, Anchor Framework (Rust)
- **CLI**: TypeScript, Commander, TOML config
- **SDK**: TypeScript, `@solana/web3.js`, `@solana/spl-token`
- **Backend**: Express, Pino, Docker
- **Demo**: React, Vite, Tailwind CSS, Solana Wallet Adapter

## License

MIT
