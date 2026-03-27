# Devnet Deployment

## Program IDs
- SSS Token: `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`
- Transfer Hook: `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

## Latest Upgrade (2026-03-22)
Includes: PBS (Probabilistic Balance Standard) + APC (Agent Payment Channel)

### Program Upgrade Transactions
- **sss_token** upgrade:
  `txY7GBGK7rFc7tBQbqxmNhc1T8EqSNJgArnW7JubkD1RmJ9SGhFsL2pzc3Cz3PVzKecRj88cJs8iu7k6cTUFxT3`
  https://solscan.io/tx/txY7GBGK7rFc7tBQbqxmNhc1T8EqSNJgArnW7JubkD1RmJ9SGhFsL2pzc3Cz3PVzKecRj88cJs8iu7k6cTUFxT3?cluster=devnet

- **sss_transfer_hook** upgrade:
  `2mLqahpYt85Syvfms3rWK7M9UEJhdMfGRcDJAMpmaGmQpiV7bkd1c9jsxpYP8xnmPsbbLLfEryJBasyyxE4qg5N2`
  https://solscan.io/tx/2mLqahpYt85Syvfms3rWK7M9UEJhdMfGRcDJAMpmaGmQpiV7bkd1c9jsxpYP8xnmPsbbLLfEryJBasyyxE4qg5N2?cluster=devnet

## Smoke Test (SSS-013 Full Lifecycle)

All transactions confirmed on-chain:

1. **Initialize SSS-1 stablecoin (Mint: `E3k8cffdF6PXv7gdjzj36nrFx4YbUuRRfpMf8uzCsucJ`)**
   Config PDA: `BvvivwWwmHfR3zkxBwUchPk9ndbbdFTk5EtvkvCszbLt`

2. **Register minter:**
   `jjwXYLuygQbFSipcmYtztctiJp3ZAUN99ToKgtVWHtS6wmzBSdkYJFYr3gADGmomiqxC4MeJEnCmSxPVg99yDLJ`
   https://explorer.solana.com/tx/jjwXYLuygQbFSipcmYtztctiJp3ZAUN99ToKgtVWHtS6wmzBSdkYJFYr3gADGmomiqxC4MeJEnCmSxPVg99yDLJ?cluster=devnet

3. **Create Token-2022 ATA (Recipient: `6vYRGGZnCvL53PvPbms54oLBrX1wj8zdyorucHzLknP6`):**
   `2iFQsQ1JKyE16L5QR6CDc3h4h31UW7qdgo4Z5PKP8wuVNcwc5no5jGQqh3RssTcm5SnyrNuMCWkuFT5yc7NtvYmM`
   https://explorer.solana.com/tx/2iFQsQ1JKyE16L5QR6CDc3h4h31UW7qdgo4Z5PKP8wuVNcwc5no5jGQqh3RssTcm5SnyrNuMCWkuFT5yc7NtvYmM?cluster=devnet

4. **Thaw recipient ATA (SSS-091 DefaultAccountState=Frozen):**
   `4RMzeahWuSD4zF8H8HQS82zwPCGUzpAet3MNStW3y8SW8HXowK87xTdyBbxE6vbBSLzQqpRFeAHqwqGBQa8cKLAm`
   https://explorer.solana.com/tx/4RMzeahWuSD4zF8H8HQS82zwPCGUzpAet3MNStW3y8SW8HXowK87xTdyBbxE6vbBSLzQqpRFeAHqwqGBQa8cKLAm?cluster=devnet

5. **Mint 1,000 SUSD to recipient:**
   `3k6zHtRyaXSfEyrHW7hkLxqhNGfAe1XSbyic2VDKjvS63xX4rgrqtTMEMNtFJVwZPySrV1p3ihLnoX3PJTjE3MSh`
   https://explorer.solana.com/tx/3k6zHtRyaXSfEyrHW7hkLxqhNGfAe1XSbyic2VDKjvS63xX4rgrqtTMEMNtFJVwZPySrV1p3ihLnoX3PJTjE3MSh?cluster=devnet

### Result
✅ Smoke Test PASSED — Supply: 1000 SUSD (1,000,000,000 raw)
Mint Explorer: https://explorer.solana.com/address/E3k8cffdF6PXv7gdjzj36nrFx4YbUuRRfpMf8uzCsucJ?cluster=devnet

## Proof Demo (PBS + APC)
Proof-demo script ran successfully in simulation mode (no live USDC mint available on devnet).
Full on-chain PBS/APC exercise requires a funded USDC-devnet mint and pre-funded agent keypairs.
The smoke test above verifies the deployed sss_token program handles the full SSS-1 lifecycle on-chain.

```bash
# Fund your keypair (~/.config/solana/id.json) with devnet SOL first:
solana airdrop 1 --url devnet

# Run smoke test:
npm run smoke:devnet
# or: npx ts-node scripts/smoke-test-devnet.ts
```

## DEVTEST-003/004 Results (2026-03-27)

### Feature Flag Integration Test (DEVTEST-003)

All 8 primary feature flags verified on live devnet — set → verify on-chain → clear → verify on-chain:

| Flag | Bit | Result |
|------|-----|--------|
| FLAG_CIRCUIT_BREAKER | 0 | ✅ PASS |
| FLAG_SPEND_POLICY | 1 | ✅ PASS |
| FLAG_DAO_COMMITTEE | 2 | ✅ PASS (DaoCommitteeRequired guard verified on CLEAR) |
| FLAG_YIELD_COLLATERAL | 3 | ✅ PASS |
| FLAG_ZK_COMPLIANCE | 4 | ✅ PASS |
| FLAG_CONFIDENTIAL_TRANSFERS | 5 | ✅ PASS |
| FLAG_SQUADS_AUTHORITY | 13 | ⏭ SKIP (irreversible; would lock devnet config) |
| FLAG_POR_HALT_ON_BREACH | 16 | ✅ PASS |

Test script: `tests/devnet/feature-flag-test.ts` / runner: `tests/devnet/run-feature-flags.sh`

### CDP Lifecycle Test (DEVTEST-004)

Scaffold in place: `tests/devnet/cdp-lifecycle-test.ts`. Steps 1–3 (init/create-cdp/deposit-collateral-account) exercised; steps 4–10 (borrow/repay/withdraw/liquidate) marked SKIP pending funded oracle + collateral on devnet.

Runner: `tests/devnet/run-cdp-lifecycle.sh`

### Smoke Test — Initialize + Feature Flags (2026-03-27)

```
✅ Smoke Test PASSED (tests/devnet/smoke-test.ts)

  Initialize SSS-1 config: tx 2uDGL4Rk...
  Set FLAG_CIRCUIT_BREAKER: flags 0x1 ✓
  Clear FLAG_CIRCUIT_BREAKER: flags 0x0 ✓
  Set FLAG_SPEND_POLICY: flags 0x2 ✓
  Config state verified on-chain
  All 6 tests pass
```

## `Anchor.toml` Program IDs (devnet + localnet)

```toml
[programs.devnet]
sss_token       = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"
sss_transfer_hook = "phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp"
cpi_caller      = "HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof"
```
