# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Solana Stablecoin Standard (SSS) — a modular, production-ready stablecoin SDK for Solana built on Token-2022. Provides three opinionated presets:
- **SSS-1 Minimal**: Internal tokens, DAO treasuries (mint, freeze, pause, minter caps)
- **SSS-2 Compliant**: Regulated stablecoins (adds permanent delegate, transfer hook, on-chain blacklist)
- **SSS-3 Trust-Minimized**: Collateral-backed with on-chain enforcement, ZK privacy, mandatory Squads multisig, immutable supply cap, oracle timelocks (SSS-147)

## Build & Test Commands

### Anchor Programs (Rust/Solana)
```bash
anchor build                    # Build all programs (sss-token, transfer-hook, cpi-caller)
anchor test                     # Build + start localnet + run tests/sss-token.ts
anchor test --skip-build        # Reuse existing build artifacts
cargo clippy -- -D warnings     # Lint Rust code (CI enforces zero warnings)
```

### TypeScript SDK (`sdk/` — `@stbr/sss-token`)
```bash
cd sdk && npm install
npx tsc --noEmit                # Type check
npx vitest run                  # Unit tests only (no backend needed)
npx vitest run --config vitest.integration.config.ts   # Integration tests (needs running backend)
npx vitest run --config vitest.anchor.config.ts        # Anchor localnet tests (needs validator)
npx vitest run src/SolanaStablecoin.test.ts             # Run a single test file
```

### Backend (Rust/axum — `backend/`)
```bash
cd backend && cargo build --release
cargo test                      # Backend unit tests
cargo clippy -- -D warnings     # Lint
```

### Root-level shortcuts
```bash
npm run build          # Build SDK + CLI
npm run test           # anchor test (full on-chain test suite)
npm run test:sdk       # SDK vitest
npm run test:backend   # Backend cargo test
npm run lint           # SDK eslint
```

### Devnet Deployment
```bash
npm run deploy:devnet           # Deploy programs to devnet
npm run smoke:devnet            # Smoke test against devnet
npm run wizard                  # Interactive 10-step deployment wizard
npm run check-deployment        # Post-deploy validation
```

## Architecture

```
Layer 3: Presets (sss1Config, sss2Config) — opinionated configurations
Layer 2: Modules (ComplianceModule, CdpModule, OracleParamsModule, etc.)
Layer 1: Base SDK (SolanaStablecoin class — Token-2022 creation, role management, mint/burn)
```

### On-Chain Programs (`programs/`)
- **sss-token**: Core Anchor program with 60+ instructions in `programs/sss-token/src/instructions/`. State/PDAs in `state.rs`, errors in `error.rs`, events in `events.rs`, Kani proofs in `proofs.rs`.
- **transfer-hook**: Token-2022 transfer hook for SSS-2 blacklist enforcement.
- **cpi-caller**: Test program for CPI composability testing.

### TypeScript SDK (`sdk/src/`)
- `SolanaStablecoin.ts` — Main entry point class, wraps all module operations.
- `presets.ts` — `sss1Config()` / `sss2Config()` factory functions.
- `*Module.ts` — Feature modules (Compliance, CDP, Oracle, Guardian, DAO, etc.), each with co-located `.test.ts`.
- `idl/` — Generated Anchor IDL JSON files. Must stay in sync with program builds (`cp target/idl/*.json sdk/src/idl/`).
- `client.ts` — HTTP client for backend API. `api-types.ts` — Shared API types.

### CPI Crate (`crates/sss-cpi/`)
- Rust crate for external programs to CPI into sss-token. Contains PDA derivation helpers, instruction builders, flag constants, and discriminators.

### Backend (`backend/src/`)
- Rust/axum REST API: mint/burn tracking, compliance/blacklist, audit log, webhooks, rate limiting. Uses SQLite (`rusqlite`).

### Integration Tests (`tests/`)
- Anchor integration tests run via `ts-mocha`. Each file typically maps to an SSS feature ticket (e.g., `sss-147-trustless-hardening.ts`).
- The `Anchor.toml` `[scripts] test` entry points to `tests/redemption_queue.ts` but `anchor test` runs the full suite.

## Key Conventions

- **All arithmetic must use `checked_*` operations** — no raw `+`, `-`, `*`, `/` in Rust. `overflow-checks = true` is enforced in Cargo.toml release profile.
- **New instructions require Kani proofs** in `programs/sss-token/src/proofs.rs`.
- **New SDK methods require vitest tests** — co-locate as `ModuleName.test.ts`.
- **Feature flags**: On-chain feature flags use bit positions in a `u64` field. Bit assignments must not collide (see `state.rs` flags and `crates/sss-cpi/src/flags.rs`).
- **IDL sync**: After `anchor build`, copy IDLs to SDK: `cp target/idl/sss_token.json sdk/src/idl/sss_token.json` (drift causes Anchor error 102).
- **Program IDs**: Devnet IDs in `Anchor.toml` and `devnet-program-ids.json`. The main program is `ApQTVMKdtUUrGXgL6Hhzt9W2JFyLt6vGnHuimcdXe811`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs four jobs: `backend` (cargo build/clippy/test), `sdk` (tsc + vitest), `anchor` (anchor build + test), and `sdk-integration` (backend + SDK integration tests). Toolchain: Solana 2.3.13, Anchor 0.32.0, Node 20.
