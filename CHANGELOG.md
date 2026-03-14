# Changelog

All notable changes to the Solana Stablecoin Standard are documented here.

---

## [Unreleased]

### Added
- `docs/compliance-module.md` — full SDK reference for `ComplianceModule` (SSS-017) [PR #73]
- `docs/ARCHITECTURE.md` — three-layer architecture reference
- `docs/SSS-1.md` — minimal preset specification
- `docs/SSS-2.md` — compliant preset specification
- `docs/SSS-3.md` — trustless collateral-backed preset reference design

---

## [0.2.0] — 2026-03-14

### SSS-017 — ComplianceModule Anchor Wiring [PR #39]

**What changed:** `ComplianceModule` previously had `isBlacklisted()` (raw byte parsing only) but no way to modify the blacklist on-chain. This release adds all three mutation methods via the Anchor IDL.

**New SDK methods:**
- `ComplianceModule.initializeBlacklist()` → calls `initialize_extra_account_meta_list` via Anchor
- `ComplianceModule.addToBlacklist(address)` → calls `blacklist_add` via Anchor
- `ComplianceModule.removeFromBlacklist(address)` → calls `blacklist_remove` via Anchor

**New files:**
- `sdk/src/idl/sss_transfer_hook.json` — Anchor IDL for the transfer-hook program (all 4 instructions, `BlacklistState` account type, 3 error codes)
- `sdk/src/ComplianceModule.test.ts` — 11 unit tests (PDA derivation, blacklist mutations, program caching, `isBlacklisted` edge cases)

**Test results:** 81/81 tests passing (6 test files)

---

## [0.1.9] — 2026-03-14

### SSS-016 — SDK Anchor IDL Wiring [PR #38]

**What changed:** `SolanaStablecoin` methods previously submitted raw transaction instructions. They now use the typed Anchor IDL for `initialize`, `mint`, and `burn`, enabling proper type checking and IDL-driven account resolution.

**Changes:**
- `sdk/src/SolanaStablecoin.ts` — `initialize`, `mintTo`, `burn` rewritten to use `@coral-xyz/anchor` program methods
- `sdk/src/idl/sss_token.json` — Anchor IDL for `sss-token` program
- `getTotalSupply()` now reads the `StablecoinConfig` PDA directly (previously approximated)

---

## [0.1.8] — 2026-03-14

### Devnet Deployment

Both programs deployed to Solana devnet:

| Program | Program ID |
|---------|-----------|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

---

## [0.1.7] — 2026-03-14

### Docs: On-Chain SDK Core Methods [PR #36]

- `docs/on-chain-sdk-core.md` — full reference for `SolanaStablecoin` class (create, mintTo, burnFrom, freeze/thaw, getTotalSupply, updateMinter, updateRoles)

---

## [0.1.6] — 2026-03-14

### CI Fixes — Agave 2.3.x + blake3 [PR #37]

**Problem:** CI was failing due to `blake3 1.8.3` being pulled in by Agave 2.3.x dependencies, which conflicted with the Anchor build toolchain. Additionally, `spl-pod` stale index caused platform-specific Cargo.lock divergence.

**Fix:**
- Committed `Cargo.lock` to the repository (previously gitignored for the workspace root)
- Pinned `blake3 = "=1.7.0"` via committed lock
- Upgraded `spl-token-confidential-transfer-*` to avoid `solana-zk-token-sdk@2.3.x` compile error
- Switched from `anchor build --locked` to `anchor build` with committed Cargo.lock

**Result:** All 4 CI jobs (TypeScript SDK, Backend, Anchor Programs, SDK Integration Tests) green on main.

---

## [0.1.5] — 2026-03-14

### Docs: Anchor Program Testing [PR #35]

- `docs/anchor-program-testing.md` — toolchain versions, CI notes, Agave 2.3.x workarounds, running tests locally

---

## [0.1.4] — 2026-03-14

### SSS-003 — Anchor Programs: 13/13 Tests Passing

**What was built:**
- `programs/sss-token/` — complete Anchor program implementing SSS-1 and SSS-2
  - Instructions: `initialize`, `mint`, `burn`, `freeze_account`, `thaw_account`, `pause`, `unpause`, `update_minter`, `revoke_minter`, `update_roles`
  - Accounts: `StablecoinConfig`, `MinterInfo`
- `programs/transfer-hook/` — SSS-2 transfer hook program
  - Instructions: `transfer_hook`, `initialize_extra_account_meta_list`, `blacklist_add`, `blacklist_remove`
  - Accounts: `BlacklistState`
- Anchor test suite: 13/13 passing on localnet

**Key fixes during development:**
- Config PDA as signer for mint/freeze/thaw via `signer_seeds`
- Token-2022 owner parsing from token account data (offset 32)
- Agave 2.3.x compatibility fixes

---

## [0.1.3] — 2026-03-14

### SSS-014 — Compliance Audit Log

- `backend/src/routes/compliance.rs` — `POST /api/compliance/blacklist`, `GET /api/compliance/blacklist`, `GET /api/compliance/audit`
- Audit log appended atomically with every blacklist mutation
- `docs/compliance-audit-log.md` — REST reference for compliance endpoints

---

## [0.1.2] — 2026-03-13

### SSS-013 — API Reference + SDK Docs

- `docs/api.md` — full REST endpoint reference (health, mint, burn, supply, events, compliance, webhooks)
- `docs/authentication.md` — API key generation and `X-Api-Key` header usage
- `docs/rate-limiting.md` — token-bucket rate limiter, `Retry-After` behaviour
- `docs/transfer-hook.md` — on-chain transfer-hook program reference (instructions, errors, account layout)

---

## [0.1.1] — 2026-03-13

### SSS-002 — Project Scaffolding

- Forked `solanabr/solana-stablecoin-standard` → `dcccrypto/solana-stablecoin-standard`
- Full project structure: `programs/`, `sdk/`, `backend/`, `cli/`, `tests/`, `docs/`
- CI: GitHub Actions workflows for TypeScript SDK, Backend (Rust/axum), Anchor Programs, SDK Integration Tests
- Docker Compose for backend + Postgres
- Devnet wallet generated and funded

---

## [0.1.0] — 2026-03-13

### SSS-001 — Initial Specification

- Project created for Superteam Brazil Solana Stablecoin Standard bounty
- SSS-1 (Minimal) and SSS-2 (Compliant) presets specified
- Architecture: three-layer model (on-chain → SDK → application)
