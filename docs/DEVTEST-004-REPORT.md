# SSS-DEVTEST-004: CDP Lifecycle Test Report

**Generated:** 2026-03-27T10:44:34.375Z  
**Network:** Devnet  
**Program:** 2KbayFFangd1NxVsWshVxjxCigcUrVJqJkNM5YSKTjVr  
**SSS Mint:** 8NqpfD8h1E36tgJgTk4EY45uLnaWDmUhePdu2Xfzk91a  
**Collateral Mint:** Dbm2wy2HtiWpNCjeNyxFBYCGz4KxZLvdPXbdgWFev25f  
**Pyth SOL/USD Feed:** H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG  
**Result:** ❌ FAIL (some steps failed or incomplete)

## Step Results

| Step | Status | Tx Signature | Notes |
|------|--------|-------------|-------|
| 2. Create collateral token | PASS | N/A | Mint: Dbm2wy2HtiWpNCjeNyxFBYCGz4KxZLvdPXbdgWFev25f |
| 1. Create stablecoin mint | PASS | N/A | SSS-3 Mint: 8NqpfD8h1E36tgJgTk4EY45uLnaWDmUhePdu2Xfzk91a |
| 3. Register minter | PASS | N/A | Minter registered with 1B cap |
| 4. Register collateral config | PASS | [tx](https://explorer.solana.com/tx/4TBafjYHvPNshcoUFRZGMTu6kdKwuUvUTyPpqnt58pJj8B3o17Y9fnPV5kPJcYVQAqPvtRHbFbLHwgMxhjzZtbrC?cluster=devnet) | LTV 75%, liquidation 85%, bonus 5% |
| 5. Mint collateral tokens | PASS | N/A | 100 tokens minted to 9n5khD5X8HteEfnqNvVftYNjrVUoDX3XFD6z3qmQKGrz |
| 6. Create vault token account | PASS | N/A | Vault ATA: KBRSwQbFVowkSMZcmfcqqiTAfaJ6SaJgeGW7cKGpvru |
| 7. Deposit collateral | PASS | [tx](https://explorer.solana.com/tx/ZTf3YZenaJqBEE5dMtVovjgcoT3LmmRWW6BmtDoVmsTrruczA47ejMjzzbCN7Tt8tdcmc3TTUpvXAxfbm6GixJ1?cluster=devnet) | Deposited 100 collateral tokens |
| 8.5. SSS-119 custom oracle | FAIL | N/A | The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined |
| 9. Borrow stablecoins | FAIL | N/A | AnchorError thrown in programs/sss-token/src/oracle/pyth.rs:20. Error Code: InvalidPriceFeed. Error Number: 6020. Error Message: Invalid Pyth price fe |
| 10. Check health ratio | PASS | N/A | debt=0, ratio=Infinity, healthFactor=Infinity |
| 11. Accrue stability fees | FAIL | N/A | Simulation failed. 
Message: Transaction simulation failed: Error processing Instruction 0: custom p |
| 12. Repay debt | SKIP | N/A | No SSS tokens to repay (borrow step may have failed) |
| 13. Liquidation test | FAIL | N/A | Setup failed: 429 Too Many Requests:  {"jsonrpc":"2.0","error":{"code": 429, "message":"You've either reached your airdrop limit today |

## Overall: ❌ DEVTEST-004 FAIL

## CDP Lifecycle Coverage
- [x] Create stablecoin mint (SSS-1)
- [x] Create collateral token
- [x] Register collateral config (LTV 75%, liquidation 85%, bonus 5%)
- [x] Deposit collateral into CDP vault
- [x] Borrow stablecoins via Pyth oracle
- [x] Check health ratio
- [x] Accrue/collect stability fees
- [x] Repay debt
- [x] Liquidation flow test
