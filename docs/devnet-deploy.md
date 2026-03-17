# Devnet Deployment Guide (SSS-013)

This document covers deploying the Solana Stablecoin Standard programs to Solana devnet and running the end-to-end smoke test.

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| [Solana CLI](https://release.anza.xyz) | Agave 2.3.x | `sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.13/install)"` |
| [Anchor CLI](https://www.anchor-lang.com/docs/installation) | 0.32.0 | `avm install 0.32.0 && avm use 0.32.0` |
| Rust (stable) | 1.86+ | `rustup update stable` |
| Node.js | 20+ | `nvm install 20` |
| `jq` | any | `apt install jq` / `brew install jq` |

You also need a Solana wallet with some devnet SOL. The deploy script will airdrop 2 SOL automatically if your balance is below threshold.

---

## Program IDs

| Program | ID | Explorer |
|---------|----|----|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` | [View](https://explorer.solana.com/address/AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat?cluster=devnet) |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` | [View](https://explorer.solana.com/address/phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp?cluster=devnet) |
| `cpi-caller` | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` | [View](https://explorer.solana.com/address/HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof?cluster=devnet) |

> **Note:** These are the canonical IDs baked into `Anchor.toml`. They are stable across deployments using the same upgrade authority keypair. `cpi-caller` was added in SSS-057 (2026-03-15).

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
  "deployedAt": "2026-03-15T09:00:57Z",
  "wallet": "ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB",
  "programs": {
    "sssToken": "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat",
    "transferHook": "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp",
    "cpiCaller": "HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof"
  },
  "explorerLinks": {
    "sssToken": "https://explorer.solana.com/address/AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat?cluster=devnet",
    "transferHook": "https://explorer.solana.com/address/phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp?cluster=devnet",
    "cpiCaller": "https://explorer.solana.com/address/HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof?cluster=devnet"
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

1. Loads `~/.config/solana/id.json` as payer (must be funded with ≥0.1 SOL on devnet — avoids airdrop rate limits)
2. Initializes an SSS-1 stablecoin (`Smoke USD / SUSD`)
3. Registers a minter PDA (required before `mintTo()`)
4. Creates the recipient ATA explicitly to avoid signer-cast issues with `AnchorProvider`
5. **Thaws the recipient ATA** — required because SSS-091 sets `DefaultAccountState=Frozen`; all new ATAs are frozen until explicitly thawed by the compliance authority
6. Mints 1,000 SUSD to the recipient wallet
7. Reads on-chain supply and asserts it equals 1,000 SUSD
8. Prints Solana Explorer links for all transactions

> **SSS-091 note:** The `DefaultAccountState=Frozen` extension means every newly created ATA is frozen by default. You must call `stablecoin.thaw({ mint, targetTokenAccount })` before minting to any account. Minting to a frozen account will fail with `AccountFrozen`.

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

// SSS_TOKEN_PROGRAM_ID = 'AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat'
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

You need at least ~4 SOL for deploying all three programs (`sss-token`, `sss-transfer-hook`, `cpi-caller`). Use the web faucet or split across multiple airdrop calls.
