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
