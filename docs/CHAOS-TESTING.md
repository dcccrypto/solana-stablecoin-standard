# SSS-141 Chaos / Fuzz Testing Guide

## Overview

The chaos test suite (CHAOS-ENV-001) runs adversarial fuzzing scenarios against the SSS program:

| Fuzzer | Scenarios | What it tests |
|--------|-----------|---------------|
| `accountFuzzer` | 15 | Wrong PDAs, swapped mints, forged signers |
| `amountFuzzer` | 14 | u64 extremes, boundary values, overflow |
| `sequenceFuzzer` | 12 | Invalid instruction ordering, state machine |
| `concurrencyFuzzer` | 9 | Race conditions, double-spend attempts |
| **Total** | **50+** | All adversarial categories |

---

## Quick Start (Localnet — Recommended)

### Prerequisites
- `anchor build` must be run first to produce `target/deploy/*.so` binaries
- `solana-test-validator` installed
- `~/.config/solana/id.json` funded (localnet auto-funds)

### 1. Start Localnet

```bash
# Start validator with SSS programs deployed + fund wallet
./scripts/deploy-localnet.sh

# Or source to inherit env vars in current shell
source scripts/deploy-localnet.sh
```

This sets:
- `CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json`
- `ANCHOR_PROVIDER_URL=http://127.0.0.1:8899`
- `ANCHOR_WALLET=~/.config/solana/id.json`

### 2. Run All Chaos Tests

```bash
export CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=~/.config/solana/id.json

npx ts-mocha -p tsconfig.json -t 1000000 \
  tests/chaos/accountFuzzer.ts \
  tests/chaos/amountFuzzer.ts \
  tests/chaos/sequenceFuzzer.ts \
  tests/chaos/concurrencyFuzzer.ts \
  tests/chaos/chaosRunner.ts
```

### 3. View Report

After running, check `docs/CHAOS-REPORT.md` for the full adversarial scenario catalogue.

---

## Running on Devnet

```bash
# Ensure your wallet has ≥ 5 SOL on devnet (chaos tests fund many ephemeral keypairs)
export CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json

npx ts-mocha -p tsconfig.json -t 1000000 \
  tests/chaos/accountFuzzer.ts \
  tests/chaos/amountFuzzer.ts \
  tests/chaos/sequenceFuzzer.ts \
  tests/chaos/concurrencyFuzzer.ts \
  tests/chaos/chaosRunner.ts
```

> **Note:** Without `CHAOS_PAYER_KEYPAIR`, fuzzers fall back to `requestAirdrop` which hits
> devnet rate limits (429 errors). Always set `CHAOS_PAYER_KEYPAIR` for devnet runs.

---

## How CHAOS_PAYER_KEYPAIR Works

The fuzzers need to fund many ephemeral test keypairs. The `airdrop()` helper in each fuzzer now:

1. **If `CHAOS_PAYER_KEYPAIR` is set**: loads the keypair from that path and uses `SystemProgram.transfer` to send SOL. This is fast, reliable, and works on any network.

2. **Fallback**: calls `requestAirdrop` — original behavior, works on localnet or devnet when rate limits are not an issue.

```typescript
// Example — how the helper works internally
async function airdrop(connection, pk, lamports = 2_000_000_000) {
  const payerPath = process.env["CHAOS_PAYER_KEYPAIR"];
  if (payerPath) {
    const funder = loadKeypair(payerPath);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pk, lamports })
    );
    await sendAndConfirmTransaction(connection, tx, [funder]);
  } else {
    const sig = await connection.requestAirdrop(pk, lamports);
    await connection.confirmTransaction(sig);
  }
}
```

---

## Troubleshooting

### Fuzzers fail with "Error: 429 Too Many Requests"
Set `CHAOS_PAYER_KEYPAIR` to a funded keypair on the target network.

### Fuzzers fail with "Program not found"
Run `anchor build` and then `./scripts/deploy-localnet.sh` to redeploy programs.

### `ConcurrencyFuzzer` passes but others fail
This is the original behavior — `ConcurrencyFuzzer` doesn't call `requestAirdrop`, so it works without `CHAOS_PAYER_KEYPAIR`. The other fuzzers need it.

### Validator crashes / can't start
Check `/tmp/solana-test-validator.log` for errors.

---

## Fix History

**CHAOS-ENV-001** (2026-03-27): Fixed all four fuzzers to use `CHAOS_PAYER_KEYPAIR` env var instead of relying solely on `requestAirdrop`. Added `scripts/deploy-localnet.sh` for one-command localnet setup.

Root cause: `requestAirdrop` is rate-limited on devnet (429) and requires a deployed program on localnet. `ConcurrencyFuzzer` wasn't affected because it didn't call airdrop internally — it passed 9/9 while others were blocked.
