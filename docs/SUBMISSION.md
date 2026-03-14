# Superteam Brazil — Solana Stablecoin Standard Submission

**Bounty:** Solana Stablecoin Standard
**Repository:** https://github.com/dcccrypto/solana-stablecoin-standard (fork of solanabr/solana-stablecoin-standard)
**Submitted by:** Khubair (dcccrypto)

---

## What We Built

A production-ready, modular SDK for issuing and managing stablecoins on Solana using Token-2022, with two fully implemented presets and a reference design for a third.

### SSS-1: Minimal Stablecoin
Token-2022 mint with freeze authority, metadata extension, pause/unpause, and minter caps. The simplest possible stablecoin — no unnecessary overhead.

### SSS-2: Compliant Stablecoin
SSS-1 plus permanent delegate, transfer hook, and an on-chain blacklist enforced at the chain level. Every transfer on an SSS-2 mint is checked against a `BlacklistState` PDA by the Solana runtime — not by off-chain middleware. No application, DEX, or bridge can bypass it.

### SSS-3: Trustless Collateral-Backed (Reference Design)
A specification for a stablecoin with on-chain collateral enforcement (no oracle), Token-2022 confidential transfers (ZK proof privacy), and a compliance blacklist simultaneously. See [SSS-3.md](./SSS-3.md).

---

## Devnet Program IDs

| Program | Program ID | Explorer |
|---------|-----------|---------|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` | [View on Solscan](https://solscan.io/account/AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat?cluster=devnet) |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` | [View on Solscan](https://solscan.io/account/phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp?cluster=devnet) |

---

## Test Results

**Anchor Programs (localnet):** 19/19 passing
**TypeScript SDK:** 102/102 passing (6 test files)
**Backend (Rust/axum):** 35/35 passing
**CI:** All 4 jobs green on main ✅

---

## How to Run Locally

### Prerequisites

```bash
# Solana CLI 1.18+ (or Agave 2.3.x)
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.13/install)"

# Anchor CLI 0.32
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.0 && avm use 0.32.0

# Node.js 18+
node --version

# Rust (stable)
rustup update stable
```

### 1. Clone and install

```bash
git clone https://github.com/dcccrypto/solana-stablecoin-standard
cd solana-stablecoin-standard
cd sdk && npm install && cd ..
```

### 2. Run Anchor tests

```bash
# This starts a local validator, deploys programs, and runs all 13 tests
anchor test
```

Expected output:
```
sss-anchor
  SSS-1 (Minimal)
    ✔ Initialize SSS-1 stablecoin
    ✔ Registers and uses a minter with a cap
    ✔ Rejects mint beyond cap
    ✔ Pause and unpause minting
    ✔ Freeze and thaw a token account
    ✔ Update roles
    ✔ Revoke minter
  SSS-2 (Compliant)
    ✔ Initialize SSS-2 stablecoin with transfer hook
    ✔ Initialize blacklist state
    ✔ Add and remove from blacklist
    ✔ Blacklisted address cannot receive tokens
    ✔ Blacklist check — sender side
    ✔ Non-authority cannot modify blacklist

19 passing
```

### 3. Run SDK tests

```bash
cd sdk
npx vitest run
```

Expected output:
```
Test Files  6 passed (6)
Tests       102 passed (102)
```

### 4. Run the backend

```bash
# Start Postgres + backend
docker compose up -d

# Verify
curl http://localhost:8080/api/health
# {"success":true,"data":{"status":"ok",...}}
```

### 5. Try the REST API

```bash
# Create an API key
curl -X POST http://localhost:8080/api/apikeys \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}'

# Record a mint event
curl -X POST http://localhost:8080/api/mint \
  -H "X-Api-Key: sss_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"mint":"<mint-pubkey>","amount":1000000,"recipient":"<wallet>"}'

# Get supply
curl http://localhost:8080/api/supply?mint=<mint-pubkey> \
  -H "X-Api-Key: sss_<your-key>"
```

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
│      REST backend (Rust/axum) · CLI · integrations      │
├─────────────────────────────────────────────────────────┤
│                     SDK Layer                            │
│    SolanaStablecoin · ComplianceModule (TypeScript)      │
├─────────────────────────────────────────────────────────┤
│                  On-Chain Layer                          │
│    sss-token (Anchor) · sss-transfer-hook (Anchor)       │
│         Token-2022 · System Program                      │
└─────────────────────────────────────────────────────────┘
```

The separation is clean: on-chain programs are the source of truth. The SDK wraps them with typed methods. The backend adds authentication, rate limiting, audit logging, and webhook delivery on top.

---

## What Makes This Innovative

### 1. On-chain compliance — not a sidecar

Most stablecoin SDKs provide a compliant backend that calls a blocklist API. Our blacklist is enforced _inside Token-2022_. The transfer hook runs inside the same transaction as the transfer, checked by the Solana runtime. No backend, no oracle, no delay.

### 2. Two presets, one SDK

`sss1Config()` and `sss2Config()` are single-function calls that configure the entire Token-2022 mint — extensions, PDAs, hook registration, blacklist initialization. Developers switch presets by changing one argument, not by rewriting infrastructure.

### 3. Typed Anchor IDL all the way down

Both programs have full Anchor IDLs exposed to the TypeScript SDK. Method calls are type-checked. Account resolution is handled by Anchor. The developer never manually constructs transaction instructions.

### 4. ComplianceModule — clean separation of concerns

Blacklist operations (hook-based, wallet-level) and freeze/thaw (Token-2022 account-level) are cleanly separated in `ComplianceModule`. The lazy-load + cache pattern means Anchor IDL loading is a one-time cost per SDK instance.

### 5. SSS-3 reference design

The SSS-3 specification demonstrates how Solana's Token-2022 stack can support a trustless, oracle-free, privacy-preserving stablecoin. No other Solana stablecoin design simultaneously offers on-chain collateral enforcement, ZK transfer privacy, and a compliance blacklist.

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Three-layer system architecture |
| [SSS-1.md](./SSS-1.md) | Minimal preset specification |
| [SSS-2.md](./SSS-2.md) | Compliant preset specification |
| [SSS-3.md](./SSS-3.md) | Trustless collateral-backed reference design |
| [on-chain-sdk-core.md](./on-chain-sdk-core.md) | `SolanaStablecoin` SDK reference |
| [compliance-module.md](./compliance-module.md) | `ComplianceModule` SDK reference |
| [transfer-hook.md](./transfer-hook.md) | On-chain transfer-hook program reference |
| [api.md](./api.md) | REST API reference |
| [devnet-deploy.md](./devnet-deploy.md) | Devnet deployment guide |
| [anchor-program-testing.md](./anchor-program-testing.md) | Anchor test suite guide |
| [integration-testing.md](./integration-testing.md) | Integration test guide |
| [CHANGELOG.md](../CHANGELOG.md) | Full changelog |

---

## Repository Structure

```
programs/
  sss-token/           Anchor program — core stablecoin (initialize, mint, burn, freeze, pause, minters)
  transfer-hook/       Transfer hook — SSS-2 blacklist enforcement (all 4 instructions)
sdk/
  src/
    SolanaStablecoin.ts    Core SDK class
    ComplianceModule.ts    Compliance (blacklist + freeze/thaw)
    idl/
      sss_token.json         Anchor IDL for sss-token
      sss_transfer_hook.json Anchor IDL for transfer-hook
  *.test.ts              81 unit tests
backend/
  src/                   Rust/axum REST server (auth, rate limiting, audit log, webhooks)
docs/                    All documentation
.github/workflows/ci.yml All CI jobs
```
