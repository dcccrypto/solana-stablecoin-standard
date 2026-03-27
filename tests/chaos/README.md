# Chaos Test Suite

## Prerequisites

1. **Build programs first:** `anchor build`
2. **Fund a payer keypair** (avoids devnet airdrop rate limits):
   ```bash
   export CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json
   ```

## Running on Localnet (recommended)

Start a local validator with programs pre-deployed:

```bash
# Terminal 1: Start validator with programs loaded
solana-test-validator \
  --bpf-program AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat target/deploy/sss_token.so \
  --bpf-program phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp target/deploy/sss_transfer_hook.so \
  --bpf-program HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof target/deploy/cpi_caller.so \
  --reset

# Terminal 2: Run chaos tests against localnet
solana config set --url localhost
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=~/.config/solana/id.json
npx ts-mocha --transpile-only -p ./tsconfig.json -t 1000000 tests/chaos/*.ts
```

## Running on Devnet

```bash
solana config set --url devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json
export CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json  # required to avoid 429s
npx ts-mocha --transpile-only -p ./tsconfig.json -t 1000000 tests/chaos/*.ts
```

## Test Files

| File | Scenarios | Description |
|------|-----------|-------------|
| accountFuzzer.ts | 15 | Wrong signers, forged PDAs, account substitution |
| amountFuzzer.ts | ~12 | Overflow, zero, u64::MAX, boundary amounts |
| sequenceFuzzer.ts | ~10 | Wrong instruction ordering, double-init |
| concurrencyFuzzer.ts | 9 | Parallel tx races, slot conflicts |
| chaosRunner.ts | — | Combined runner |

## Known Issues

- **CHAOS-ENV-001:** On bare localnet without `--bpf-program` flags, tests fail with `AccountNotFound` because programs aren't deployed. Always use the startup command above.
- Devnet `requestAirdrop` is rate-limited (429). Set `CHAOS_PAYER_KEYPAIR` to a funded keypair.
