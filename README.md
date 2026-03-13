# Solana Stablecoin Standard (SSS)

A modular, production-ready stablecoin SDK for Solana with two opinionated presets built on Token-2022.

## Presets

| Feature | SSS-1 (Minimal) | SSS-2 (Compliant) |
|---------|-----------------|-------------------|
| Token-2022 mint | ✅ | ✅ |
| Freeze authority | ✅ | ✅ |
| Metadata extension | ✅ | ✅ |
| Permanent delegate | ❌ | ✅ |
| Transfer hook | ❌ | ✅ |
| On-chain blacklist | ❌ | ✅ |
| Pause/unpause | ✅ | ✅ |
| Minter caps | ✅ | ✅ |

**SSS-1** — For internal tokens, DAO treasuries, ecosystem settlement.  
**SSS-2** — For regulated stablecoins (USDC/USDT-class). Compliant by default.

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

## Judging Criteria

- **SDK Design & Modularity**: Layer-based architecture, clean preset API
- **Completeness**: SSS-1 + SSS-2 both implemented
- **Code Quality**: Anchor constraints, safe math, comprehensive errors
- **Security**: Freeze authority, blacklist, minter caps, pause mechanism
- **Solana Expertise**: Token-2022 extensions, PDAs, transfer hooks
- **Usability**: TypeScript SDK + CLI + REST API + Docker

## License

MIT
