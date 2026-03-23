# Solana Stablecoin Standard (SSS)

A complete, production-grade toolkit for deploying and managing stablecoins on Solana using Token-2022 extensions.

The project defines two compliance presets — **SSS-1** (minimal) and **SSS-2** (compliant with blacklist enforcement) — and provides everything needed to go from zero to a fully operational stablecoin: a CLI for operators, a TypeScript SDK for integrators, a REST backend for infrastructure, an on-chain Anchor program for transfer-hook compliance, and a React demo that ties it all together.

### Live Demo & On-Chain References

- [Video Demo](https://youtu.be/3y86hHGvMO4) — Full walkthrough of the CLI, SDK, backend, and React demo

**Programs deployed (devnet):**
- [SSS-Core Program](https://solscan.io/account/4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD?cluster=devnet) — Stablecoin config, RBAC, quotas, seize
- [Blacklist Transfer Hook Program](https://solscan.io/account/84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6?cluster=devnet) — Transfer-hook blacklist enforcement

**On-chain examples (devnet):**
- [SSS-2 Stablecoin Deployment](https://solscan.io/token/GMrcrkemTGgxFgQx6t3WHXjkqSNUqG7CkDZygD5rfjVB?cluster=devnet#extensions) — Deployed token with blacklist transfer hook
- [Mint Transaction](https://solscan.io/tx/5LawZtW6dzxSCkBARNj6eNqMUE6g7pMzrdChJwZQJKJbUL6nbjM3tkNtGfSHqJj26gqRXAngiV9vjtPYmj8M9moG?cluster=devnet) — Minting tokens to a recipient
- [Blacklist Transaction](https://solscan.io/tx/2HwoGKbKvj2so4sLVBehn61fDaj1WEWWVft6gfAnoiREBFHX1YX9soAg4hBADLadTGwCgsTHmbmdDR6t66ybb8uN?cluster=devnet) — Adding a wallet to the blacklist
- [Unblacklist Transaction](https://solscan.io/tx/PvMKv7oXb51EwqC5KFBuUWdH3vTvwQJeEnSXtQb5FTMkVATRcJbpGLPn29AYzLkjWNoVVEuJ24A1squNNwmaHiL?cluster=devnet) — Removing a wallet from the blacklist
- [Transfer After Unblacklist](https://solscan.io/tx/2HMfvYhSBxEQn3YH3f6vRycbALoB5ivcCuAStKV2qz66nDyFchXPTj4uay9mrYv5TenYA5VRH1HZcQg6A7NFMJC3?cluster=devnet) — TransferChecked succeeding after unblacklist

## Repository Structure

```
solana-stablecoin-standard/
├── programs/sss-core/          Anchor program — stablecoin config, RBAC, quotas, seize
├── transfer_hooks/blacklist/   Anchor program — transfer-hook blacklist (SSS-2)
├── tests-litesvm/              LiteSVM Rust-native fuzz & integration tests
├── cli/                        Command-line interface for deploying & managing stablecoins
├── sdk/                        TypeScript SDK wrapping all on-chain operations
├── backend/                    REST API service (mint/burn lifecycle, webhooks, event listener)
├── demo/                       React + Phantom wallet demo app
└── docs/                       Full documentation
```

## Standards

| Standard | What it provides | Token-2022 Extensions |
|----------|-----------------|----------------------|
| **SSS-1** | Minimal stablecoin — mint/burn, freeze, on-mint metadata | Metadata Pointer |
| **SSS-2** | SSS-1 + compliance — blacklist enforcement via transfer hook, KYC-gated accounts | Metadata Pointer, Transfer Hook, DefaultAccountState::Frozen |

**SSS-Core features**: RBAC roles, per-minter quotas, supply cap, triple-layer pause (Token-2022 + SSS-Core + hook), metadata updates, compliance toggle, burn-from-any-account, and **reserve attestation** (proof-of-reserve for GENIUS Act compliance) — with a **feature-gated module system** (`compliance`, `quotas`, `supply-cap`) that lets issuers strip modules they don't need at compile time.

See [docs/SSS-1.md](docs/SSS-1.md) and [docs/SSS-2.md](docs/SSS-2.md) for the full specifications.

## Quick Start

### 1. Deploy a stablecoin (CLI)

```bash
cd cli && npm install && npm run build

# Generate a starter config
npx solana-stable init --preset sss-1

# Edit sss-token.config.toml (set authorities, name, symbol)
# Then deploy
npx solana-stable init --custom sss-token.config.toml

# Mint tokens
npx solana-stable operate mint <recipient-wallet> 1000000
# or (flat, backward-compatible):
npx solana-stable mint <recipient-wallet> 1000000
```

The CLI organizes commands into groups: `operate` (mint/burn/transfer), `admin` (freeze/thaw/pause/set-authority), `compliance` (blacklist management), and `inspect` (status/supply/balance/audit-log). Flat commands still work for backward compatibility.

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
| [docs/SSS-SPEC.md](docs/SSS-SPEC.md) | **Formal specification** — SSS-1, SSS-2, SSS-Core, SDK/CLI interface |
| [docs/README.md](docs/README.md) | Overview, quick start, preset comparison, architecture diagram |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layer model, data flows, security model |
| [docs/SDK.md](docs/SDK.md) | Presets, custom configs, TypeScript examples |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Operator runbook (mint, freeze, blacklist, etc.) |
| [docs/SSS-1.md](docs/SSS-1.md) | Minimal stablecoin standard specification |
| [docs/SSS-2.md](docs/SSS-2.md) | Compliant stablecoin standard specification |
| [docs/COMPLIANCE.md](docs/COMPLIANCE.md) | Regulatory considerations, audit trail format |
| [docs/API.md](docs/API.md) | Backend REST API reference |

Each component also has its own README:

- [programs/sss-core/README.md](programs/sss-core/README.md) — SSS-Core program (RBAC, quotas, seize)
- [transfer_hooks/blacklist/README.md](transfer_hooks/blacklist/README.md) — Blacklist hook program
- [cli/README.md](cli/README.md) — CLI usage and config reference
- [sdk/README.md](sdk/README.md) — SDK API and examples
- [backend/README.md](backend/README.md) — Backend setup and endpoints
- [demo/README.md](demo/README.md) — React demo app

## Tech Stack

- **On-chain**: Solana, Token-2022, Anchor Framework (Rust)
- **CLI**: TypeScript, Commander, TOML config
- **SDK**: TypeScript, `@solana/web3.js`, `@solana/spl-token`
- **Backend**: Express, Pino, Docker
- **Demo**: React, Vite, Tailwind CSS, Solana Wallet Adapter

## Screenshots

The React demo provides a full management UI with Phantom wallet integration.

### Settings

Configure the RPC endpoint, mint address, token program, and transfer hook program ID.

![Settings](docs/assets/demo-settings.png)

### Dashboard

Live view of supply, decimals, your wallet balance, and on-chain authorities.

![Dashboard](docs/assets/demo-dashboard.png)

### Mint & Burn

Mint tokens to any wallet or burn from your own — every action triggers a Phantom signature prompt.

![Mint & Burn](docs/assets/demo-mint-burn.png)

### Account Management

Freeze, thaw, check balances, and update authorities.

![Accounts](docs/assets/demo-accounts.png)

### Compliance (SSS-2)

Add or remove wallets from the on-chain blacklist and check status in real time.

![Compliance](docs/assets/demo-compliance.png)

## License

MIT
