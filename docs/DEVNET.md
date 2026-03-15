# Devnet Deployment — SSS-057

All three SSS programs are deployed to Solana **devnet**.

## Program IDs

| Program | ID | Explorer |
|---------|-----|----------|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` | [View](https://explorer.solana.com/address/AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat?cluster=devnet) |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` | [View](https://explorer.solana.com/address/phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp?cluster=devnet) |
| `cpi-caller` | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` | [View](https://explorer.solana.com/address/HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof?cluster=devnet) |

## Deployment Details

| Program | Slot | Authority |
|---------|------|-----------|
| `sss-token` | 448609938 | `ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB` |
| `sss-transfer-hook` | 448610065 | `ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB` |
| `cpi-caller` | 448614758 | `ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB` |

**Deploy tx (cpi-caller):** `548vfeGuDt6BrpifvfeK3f7aMtQzykvDY15smF7H3HXfUcyBkZ4z8zXvoeUot8hPtSD24wRPHuwaLnWpr7LxdffW`

## Deployed At

2026-03-15 — SSS-057 (all 3 directions: PoR, CDP, CPI Composability)

## Smoke Test Results (2026-03-15)

```
✅  Smoke Test PASSED

  Mint:       F36xJcJ1zvVLXVD64YMeiQMBM86h97kbzsSywL17xWFX
  Supply:     1000 SUSD (1000000000 raw)
  Explorer:   https://explorer.solana.com/address/F36xJcJ1zvVLXVD64YMeiQMBM86h97kbzsSywL17xWFX?cluster=devnet
```

Key transactions:
- Register minter: [`4JLYUe...`](https://explorer.solana.com/tx/4JLYUeSj5bWvmgCtYkNaMnZdhfu3f2ncjWG5ABb7cWND3er1PGTz5rB8kbTkxu17k25Mq7JhnVF5FNnBSSYS943s?cluster=devnet)
- Create ATA: [`3mwjxG...`](https://explorer.solana.com/tx/3mwjxG3y9tuHhbAfA8cUrr1sf8x8Cc7HT1nm97PTv8CwPHiHohDxumm8PoygYkvKozFZFDghkN875jqEWy8aUcgS?cluster=devnet)
- Mint 1000 SUSD: [`94JaEv...`](https://explorer.solana.com/tx/94JaEvhKFCobvJsvJToynk59rgcwXmG2wLHU8ovj4YDyAYG5VBn3EctVJ4mvfxAy1woJNCV6qejdvUnHy6zRBAX?cluster=devnet)

## Running Smoke Tests

```bash
# Fund your keypair (~/.config/solana/id.json) with devnet SOL first:
solana airdrop 1 --url devnet

# Run smoke test:
npm run smoke:devnet
# or: npx ts-node scripts/smoke-test-devnet.ts
```

## `Anchor.toml` Program IDs (devnet + localnet)

```toml
[programs.devnet]
sss_token       = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"
sss_transfer_hook = "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp"
cpi_caller      = "HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof"
```
