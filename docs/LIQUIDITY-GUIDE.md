# SSS Liquidity Seeding Guide

This guide explains how to seed initial AMM liquidity for a new SSS stablecoin deployment using the `scripts/seed-liquidity.ts` tooling.

---

## Overview

When you deploy an SSS stablecoin, holders need a market where they can swap it for USDC at or near the $1.00 peg. Seeding AMM liquidity on day one achieves this by:

1. **Bootstrapping price discovery** — the pool price signal is observable by CDPs, PSM, and liquidation bots
2. **Reducing peg deviation** — deep concentrated liquidity around $1.00 absorbs buy/sell pressure
3. **Reducing arbitrage surface** — tight range means arbitrageurs need less capital to correct deviations

The `seed-liquidity.ts` script supports two AMMs:

| AMM | Protocol | Position type |
|-----|----------|---------------|
| Orca Whirlpools | Concentrated Liquidity Market Maker (CLMM) | NFT position |
| Raydium CLMM | Concentrated Liquidity | NFT position |

Both are Uniswap v3-style CLMM pools. You should seed at least one; we recommend **Orca** as the primary pool and **Raydium** as secondary.

---

## Prerequisites

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build   # or: npx tsc
```

You'll need:
- A funded Solana wallet (devnet: `solana airdrop 2`)
- Your SST mint address (from `anchor deploy`)
- USDC mint address (`Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` on devnet)

---

## Recommended Initial Pool Parameters

### Orca Whirlpool (SST/USDC)

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| Tick spacing | `1` | Tightest available; ideal for stablecoins |
| Fee tier | 0.01% (1 bps) | Standard for stable pairs |
| Tick range | ±10 ticks | Covers ±0.01% around peg at spacing=1 |
| Initial liquidity | ≥ $50k notional | Rule of thumb: 1% of expected daily volume |
| Price slippage guard | 1% | Prevents front-running of pool init tx |

For fee tiers, see: https://docs.orca.so/reference/whirlpools-overview

### Raydium CLMM (SST/USDC)

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| Tick spacing | `1` | |
| Fee tier | 0.01% | Raydium stable pool config |
| Tick range | ±100 ticks | |
| Initial liquidity | ≥ $25k notional | Can be less than Orca if Orca is primary |

---

## Seeding an Orca Pool

```ts
import { seedOrcaPool, OrcaPoolConfig } from "./scripts/seed-liquidity";
import { Connection, Keypair, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import fs from "fs";

// Load your wallet keypair
const walletKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.WALLET_PATH!, "utf-8")))
);

const config: OrcaPoolConfig = {
  connection: new Connection(clusterApiUrl("devnet"), "confirmed"),
  wallet: walletKeypair,
  sstMint: new PublicKey("YOUR_SST_MINT"),
  usdcMint: new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"),  // devnet USDC
  whirlpoolConfig: new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"),  // devnet
  sstAmountRaw: new BN(50_000_000_000), // 50,000 SST @ 6 decimals
  tickSpacing: 1,
  tickRangeHalfWidth: 10,
};

const result = await seedOrcaPool(config);
console.log(result.summary);
// Save positionMint for future rebalancing
```

---

## Seeding a Raydium Pool

```ts
import { seedRaydiumPool, RaydiumPoolConfig } from "./scripts/seed-liquidity";
import { Connection, Keypair, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

const config: RaydiumPoolConfig = {
  connection: new Connection(clusterApiUrl("devnet"), "confirmed"),
  wallet: walletKeypair,
  sstMint: new PublicKey("YOUR_SST_MINT"),
  usdcMint: new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"),
  sstAmountRaw: new BN(25_000_000_000), // 25,000 SST
};

const result = await seedRaydiumPool(config);
console.log(result.summary);
```

---

## Monitoring Pool Health

Use `checkPoolHealth` to monitor peg deviation and depth:

```ts
import { checkPoolHealth } from "./scripts/seed-liquidity";

const health = await checkPoolHealth(
  poolAddress,
  connection,
  wallet,
  "orca"   // or "raydium"
);

console.log(`Price:         $${health.currentPrice.toFixed(6)}`);
console.log(`Peg deviation: ${health.pegDeviationBps} bps`);
console.log(`Price impact:  ${health.priceImpactBps1k} bps per $1k swap`);
console.log(`Healthy:       ${health.healthy}`);
```

Or from the CLI:

```bash
ts-node scripts/seed-liquidity.ts check-health <poolAddress> orca
# Exit code 2 if pool is unhealthy (pegDeviationBps > 50)
```

**Alert thresholds:**

| Metric | Warning | Critical |
|--------|---------|---------|
| Peg deviation | > 25 bps | > 50 bps |
| Price impact ($1k) | > 10 bps | > 50 bps |

---

## Rebalancing a Position

When the peg drifts significantly, the concentrated position may move out of range. Use `rebalancePosition` to re-center:

```ts
import { rebalancePosition, checkPoolHealth } from "./scripts/seed-liquidity";

const health = await checkPoolHealth(poolAddress, connection, wallet);

if (health.pegDeviationBps > 25) {
  // Widen range slightly during volatility
  const newHalfWidth = health.pegDeviationBps > 40 ? 50 : 20;

  const result = await rebalancePosition(
    poolAddress,
    positionMint,
    newHalfWidth,
    connection,
    wallet
  );
  console.log(result.summary);
}
```

**Rebalancing strategy for SSS issuers:**

1. Monitor `pegDeviationBps` every 5 minutes via the SSS monitoring bot (`backend/src/monitor/`)
2. If deviation > 25 bps for 3 consecutive checks → trigger rebalance with `halfWidth = 20`
3. If deviation > 50 bps → trigger rebalance with `halfWidth = 50` AND alert via SSS alerting
4. After rebalance, re-seed liquidity to original depth if balance was drawn down

---

## Automation: GitHub Actions Cron

Add to `.github/workflows/liquidity-monitor.yml`:

```yaml
name: Pool Health Monitor
on:
  schedule:
    - cron: "*/5 * * * *"   # every 5 minutes

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: "20" }
      - run: npm ci
      - name: Check pool health
        run: |
          ts-node scripts/seed-liquidity.ts check-health ${{ vars.ORCA_POOL_ADDRESS }} orca
        env:
          RPC_URL: ${{ secrets.DEVNET_RPC_URL }}
```

---

## Security Notes

- **Never commit wallet keypairs.** Use environment variables or a hardware wallet for mainnet seeding.
- Positions are owned by the wallet that seeds them. If you lose access to that wallet, you lose the position.
- For mainnet, consider using a Squads multisig (SSS-4 preset) as the LP wallet authority.
- Rebalancing transactions update the NFT position on-chain; confirm the tx before assuming success.

---

## Supported Networks

| Network | Orca Config | USDC Mint |
|---------|------------|-----------|
| Devnet  | `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR` | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` |
| Mainnet | `2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

---

*See also: [MONITORING.md](MONITORING.md) for the SSS invariant monitoring bot that watches pool health in real time.*
