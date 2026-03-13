# Devnet Deployment Guide (SSS-013)

This document covers deploying the Solana Stablecoin Standard programs to Solana devnet and running the end-to-end smoke test.

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) | 1.18+ | `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"` |
| [Anchor CLI](https://www.anchor-lang.com/docs/installation) | 0.30.1 | `avm install 0.30.1 && avm use 0.30.1` |
| Rust (stable) | 1.78+ | `rustup update stable` |
| Node.js | 20+ | `nvm install 20` |
| `jq` | any | `apt install jq` / `brew install jq` |

You also need a Solana wallet with some devnet SOL. The deploy script will airdrop 2 SOL automatically if your balance is below threshold.

---

## Program IDs

| Program | ID |
|---------|----|
| `sss-token` | `4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN` |
| `sss-transfer-hook` | `8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj` |

> **Note:** These are the canonical IDs baked into `Anchor.toml`. They are stable across deployments using the same upgrade authority keypair.

---

## Deploying to Devnet

```bash
# Clone the repo (if not already)
git clone https://github.com/dcccrypto/solana-stablecoin-standard
cd solana-stablecoin-standard

# Option A: npm script
npm run deploy:devnet

# Option B: run directly
bash scripts/deploy-devnet.sh
```

The script will:

1. ✅ Verify prerequisites (`solana`, `anchor`, `node`, `jq`)
2. 🌐 Switch Solana CLI to devnet
3. 💰 Check balance and airdrop 2 SOL if needed
4. 🔨 Build all programs (`anchor build`)
5. 🚀 Deploy programs (`anchor deploy --provider.cluster devnet`)
6. 📝 Write `deploy/devnet-latest.json` with deployed addresses and Explorer links

### Output

After a successful run, `deploy/devnet-latest.json` will look like:

```json
{
  "cluster": "devnet",
  "deployedAt": "2026-03-13T20:35:00Z",
  "wallet": "YourWalletPubkey...",
  "programs": {
    "sssToken": "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN",
    "transferHook": "8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj"
  },
  "explorerLinks": {
    "sssToken": "https://explorer.solana.com/address/4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN?cluster=devnet",
    "transferHook": "https://explorer.solana.com/address/8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj?cluster=devnet"
  }
}
```

---

## Smoke Test

After deployment, verify the full SSS-1 lifecycle on devnet:

```bash
# Option A: npm script
npm run smoke:devnet

# Option B: run directly
npx ts-node scripts/smoke-test-devnet.ts
```

The smoke test:

1. Generates a throwaway payer keypair and airdrops 1 SOL
2. Initializes an SSS-1 stablecoin (`Smoke USD / SUSD`)
3. Mints 1,000 SUSD to a recipient wallet
4. Reads on-chain supply and asserts it equals 1,000 SUSD
5. Prints Solana Explorer links for all transactions

### Expected output

```
✅  Smoke Test PASSED

  Mint:       <mint-address>
  Supply:     1000 SUSD (1000000000 raw)
  Explorer:   https://explorer.solana.com/address/<mint>?cluster=devnet
```

---

## Using the Deployed Programs

Once deployed, the SDK uses the correct program IDs automatically:

```typescript
import { SolanaStablecoin, SSS_TOKEN_PROGRAM_ID, sss1Config } from '@stbr/sss-token';
import { Connection } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// SSS_TOKEN_PROGRAM_ID = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN'
const stablecoin = await SolanaStablecoin.create(provider, sss1Config({
  name: 'My USD',
  symbol: 'MUSD',
}));

console.log('Mint:', stablecoin.mint.toBase58());
```

---

## Troubleshooting

### Airdrop fails

Devnet faucets rate-limit per IP. If the airdrop fails:

```bash
# Manually airdrop
solana airdrop 2 --url devnet

# Or use the web faucet
# https://faucet.solana.com
```

### `anchor: command not found`

```bash
# Install avm (Anchor Version Manager) first
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1
avm use 0.30.1
```

### Deploy fails with "insufficient funds"

You need at least ~3 SOL for deploying two programs. Use the web faucet or split across multiple airdrop calls.
