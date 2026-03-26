# SSS Deployment Record

## Devnet — 2026-03-26 (SSS-DEVNET-001)

**Deployed Commit:** `1714c1a` (main)
**Deployer:** `ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB`

### Program IDs

| Program | Address | Last Deployed Slot |
|---------|---------|-------------------|
| sss_token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` | 451132310 |
| sss_transfer_hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` | 451132325 |
| cpi_caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` | 451132341 |

### Upgrade Transactions

| Program | Tx Signature |
|---------|-------------|
| sss_token | `2gnfEfwg9FYxnahknEWVJcWfWKcggNmoRzwdsSDyCsWbFrntrLcF7j4APgduq7AzBSXvCBtcdEF5jkaMtrf6qzfR` |
| sss_transfer_hook | `5UwfHTBSkonYJRusYGQG3HesCCXZRMCmZFewhbwdJ7RRrEWkF8eM5oXVrBYhveR6LMpoYFhj82md3QmmtsqCPf7t` |
| cpi_caller | `pejoFMeNoSq2GZkdrHnJfDSBKvMCtY5urfNtshBJijcEiJC93dc6hvVZHuMt4iakyqgYWf9zpx7mwcg6f4ruu3s` |

### Included Features (since last deploy 2026-03-22)

All fixes and features merged to main through commit `1714c1a`:

- BUG-003: Sanctions oracle PDA spoofing guard (PR #281, #282)
- BUG-008: PoR halt CPI mint enforcement (PR #263)
- BUG-014: CDP liquidate v2 circuit breaker (PR #265)
- BUG-015/016: Stability fee double-count + accrued_fees reset after burn (PR #267, #283, #284)
- BUG-017: Oracle timelock (PR #269, #270)
- BUG-018: Guardian pause override (PR #271)
- BUG-019: Compliance authority timelock (PR #272, #273)
- BUG-020: CDP liquidate v2 circuit breaker v2 (PR #274, #275)
- BUG-022: Blacklist freeze enforcement (PR #278)
- BUG-023: Hook fail-open fix (PR #280)
- BUG-024: Permanent delegate consent (FLAG_REQUIRE_OWNER_CONSENT, bit 15) (PR #285, #286)
- BUG-029: Kani proof cleanup (PR #287)
- BUG-030: Kani on-chain proofs (PR #291, #292)
- BUG-031: Bad debt backstop on-chain shortfall (PR #289, #290)
- SSS-154: Redemption queue (PR #262)
- SSS-156: Issuer legal entity registry (FLAG_LEGAL_REGISTRY, bit 24) (PR #288)
- CRIT-01: Missing type definitions for compilation (PR #293 → cherry-picked to main)
- Fix: Duplicate SanctionsRecordMissing renamed SanctionsRecordMissingBug003 (commit 1714c1a)

### Smoke Test Status

Devnet public RPC rate-limited test wallet airdrops during test run.
On-chain program upgrades confirmed via slot verification:
- sss_token: slot 451132310 ✅
- sss_transfer_hook: slot 451132325 ✅
- cpi_caller: slot 451132341 ✅

Full anchor test suite requires funded devnet wallets. Previous smoke test
(2026-03-22 DEVNET.md) confirmed full lifecycle: init → register_minter →
create_ata → thaw → mint → burn flow.

### Explorer Links

- sss_token: https://explorer.solana.com/address/AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat?cluster=devnet
- sss_transfer_hook: https://explorer.solana.com/address/phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp?cluster=devnet
- cpi_caller: https://explorer.solana.com/address/HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof?cluster=devnet
