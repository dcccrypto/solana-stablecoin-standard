# SSS-042 — Spike Validation Suite

Integration tests and validation harnesses for the 5 revolutionary research directions explored in SSS-032 / SSS-033.

## Directions Covered

| # | Direction | Test File |
|---|-----------|-----------|
| 1 | Proof-of-Reserves (Merkle) | `01-proof-of-reserves.test.ts` |
| 2 | CDP Vault Collateral Ratio Math | `02-cdp-collateral-math.test.ts` |
| 3 | CPI Composability Interface Stubs | `03-cpi-composability.test.ts` |
| 4 | Compliance Rule Engine (sample rules) | `04-compliance-rule-engine.test.ts` |
| 5 | Token-2022 Confidential Transfer Setup | `05-token22-confidential-transfer.test.ts` |

## Running

```bash
# From repo root
npx vitest run tests/spikes/

# Individual suite
npx vitest run tests/spikes/01-proof-of-reserves.test.ts
```

All tests are pure unit / property tests — no localnet required.

## Design Notes

- Tests use **vitest** with no external Solana RPC dependency.
- Merkle proofs use a minimal SHA-256 implementation compatible with what an on-chain program would use.
- CDP math tests use property-based enumeration to cover edge cases.
- CPI stubs are verified to compile-time-correct shapes (TypeScript structural typing).
- Compliance rule engine evaluates rules against sample transaction metadata.
- Token-2022 confidential transfer: validates `ElGamal` keypair structure and `WithheldAmount` aggregation logic.
