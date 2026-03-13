# Anchor Program Tests (SSS-015)

This document covers running the on-chain Anchor integration test suite locally and explains how the `Anchor Programs` CI job works.

---

## Overview

The Anchor test suite (`tests/sss-token.ts`) deploys the `sss-token` program to a local validator and exercises every on-chain instruction end-to-end via the Anchor TypeScript client.

| Suite | Command | Requires | Coverage |
|-------|---------|----------|----------|
| **Anchor program tests** | `anchor test` (repo root) | Solana CLI, Anchor CLI, Rust | 13 on-chain instruction tests |
| **SDK unit tests** | `npm test` (in `sdk/`) | Node.js | SDK logic, type safety |
| **SDK integration tests** | `npm run test:integration` (in `sdk/`) | Live axum backend | Full REST round-trips |

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | ≥ 1.75 | `rustup update stable` |
| Solana CLI | 1.18.x or Agave 3.x | [anza.xyz/install](https://release.anza.xyz) |
| Anchor CLI | 0.32.0 | `cargo install avm --locked && avm install 0.32.0 && avm use 0.32.0` |
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |

> **Note:** `@coral-xyz/anchor-cli` (npm) only covers Anchor ≤ 0.31.x.  
> Anchor 0.32+ is distributed via [AVM](https://github.com/coral-xyz/avm).

---

## Running Locally

### 1. Install root dependencies

```bash
npm install
```

### 2. Generate a local keypair (first time only)

```bash
solana-keygen new --no-bip39-passphrase --outfile ~/.config/solana/id.json
```

### 3. Run the full test suite

```bash
anchor test
```

This command:
1. Builds the `sss-token` program (`anchor build`)
2. Generates the IDL at `target/idl/sss_token.json`
3. Spawns a local validator and deploys the program
4. Runs `tests/sss-token.ts` via Mocha
5. Tears down the validator

Expected output: **13 passing** (≤ 60 s)

---

## Test Coverage

All 13 tests live in `tests/sss-token.ts` and cover the full `sss-token` program lifecycle.

### Initialization

| Test | Instruction | What's verified |
|------|-------------|-----------------|
| `initializes an SSS-1 stablecoin` | `initialize` | Token-2022 mint created; config PDA has correct preset, decimals, name, symbol, URI |
| `rejects invalid preset` | `initialize` | Preset value `99` rejected with `InvalidPreset` error |

### Minter management & minting

| Test | Instruction | What's verified |
|------|-------------|-----------------|
| `registers a minter with a cap` | `update_minter` | Minter PDA created with the specified `cap` |
| `mints tokens to a recipient` | `mint` | Recipient ATA receives correct token amount; `minted_so_far` increments |
| `rejects mint exceeding cap` | `mint` | Attempt to mint beyond minter cap rejected with `MintCapExceeded` |
| `burns tokens` | `burn` | Tokens removed from account; `minted_so_far` decrements |

### Pause / unpause

| Test | Instruction | What's verified |
|------|-------------|-----------------|
| `pauses the mint` | `pause` | Config `paused` flag set to `true` |
| `rejects mint while paused` | `mint` | Mint call rejected with `MintPaused` when program is paused |
| `unpauses the mint` | `unpause` | Config `paused` flag cleared; minting resumes |

### Freeze / thaw (compliance)

| Test | Instruction | What's verified |
|------|-------------|-----------------|
| `freezes a token account` | `freeze_account` | ATA state transitions to `Frozen` |
| `thaws a frozen token account` | `thaw_account` | ATA state returns to `Initialized` |

### Authority management

| Test | Instruction | What's verified |
|------|-------------|-----------------|
| `updates authority` | `update_roles` | Admin and compliance authority reassigned to new keypairs |
| `revokes a minter` | `revoke_minter` | Minter PDA closed; minter can no longer mint |

---

## CI Pipeline

Anchor tests run in the **`Anchor Programs`** CI job (`.github/workflows/ci.yml`).

### What the job does

1. Checks out the repo and installs Node.js + root dependencies.
2. Downloads and caches Solana CLI (`~/.local/share/solana`).
3. Installs Anchor 0.32.0 via AVM (`cargo install avm && avm install/use`).
4. Generates a fresh ephemeral keypair.
5. Regenerates `Cargo.lock` (v3) compatible with the Solana 1.18 / rustc 1.75 toolchain and pins `blake3 =1.7.0` (last `edition2021` release).
6. Runs `anchor build` — compiles `sss_token.so` and generates the IDL.
7. Runs `anchor test` — spawns a local validator, deploys, tests, tears down.

### Notes on Anchor 0.32 IDL generation

Anchor 0.32 uses the **`idl-build`** compile-time feature (stable Rust ≥ 1.89) for IDL generation, replacing the old `cargo +nightly test` approach used in 0.30.x. No nightly toolchain or `RUSTUP_TOOLCHAIN` override is required.

### Cargo.lock compatibility

The Solana 1.18 BPF toolchain ships cargo ~1.75, which cannot parse lockfile v4. The CI regenerates a v3-compatible `Cargo.lock` on each run using `cargo generate-lockfile` followed by `sed -i 's/^version = 4$/version = 3/' Cargo.lock`.

The `blake3` pin (`=1.7.0`) is required because `blake3 ≥ 1.8.0` uses the `edition2024` resolver feature, which requires Cargo ≥ 1.85 — not available with Cargo 1.75.

---

## Troubleshooting

### `anchor build` fails with `edition2024` error

Ensure `blake3` is pinned to `=1.7.0` in `Cargo.lock`. Regenerate the lockfile:

```bash
cargo generate-lockfile
cargo update blake3 --precise 1.7.0
```

### `anchor: command not found`

Install Anchor 0.32 via AVM:

```bash
cargo install avm --locked
avm install 0.32.0
avm use 0.32.0
```

Ensure `~/.avm/bin` is on your `PATH`.

### Local validator fails to start

Check that `solana-test-validator` is available:

```bash
solana-test-validator --version
```

If missing, reinstall the Solana CLI for your platform via [anza.xyz](https://release.anza.xyz).

### `TypeErrors` in test output

Make sure root `node_modules` are installed (`npm install` in the repo root) and that the `target/types/sss_token.d.ts` type file exists after `anchor build`.
