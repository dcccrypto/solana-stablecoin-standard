# Superteam Brazil — Solana Stablecoin Standard Submission

**Bounty:** Solana Stablecoin Standard
**Repository:** https://github.com/dcccrypto/solana-stablecoin-standard (fork of solanabr/solana-stablecoin-standard)
**Submitted by:** Khubair (dcccrypto)

---

## What We Built

A production-ready, modular SDK for issuing and managing stablecoins on Solana using Token-2022, with two fully implemented presets, a full reference implementation of SSS-3, a REST backend with auth/audit/webhooks, and 7 formally-verified mathematical invariants.

### SSS-1: Minimal Stablecoin
Token-2022 mint with freeze authority, metadata extension, pause/unpause, and minter caps. The simplest possible stablecoin — no unnecessary overhead.

### SSS-2: Compliant Stablecoin
SSS-1 plus permanent delegate, transfer hook, and an on-chain blacklist enforced at the chain level. Every transfer on an SSS-2 mint is checked against a `BlacklistState` PDA by the Solana runtime — not by off-chain middleware. No application, DEX, or bridge can bypass it.

### SSS-3: Trustless Collateral-Backed
A full specification and partial on-chain implementation for a stablecoin with on-chain collateral enforcement (no oracle), Token-2022 confidential transfers (ZK proof privacy), and a compliance blacklist simultaneously. Features implemented: `deposit_collateral`, `redeem` instructions, `max_supply` enforcement. See [SSS-3.md](./SSS-3.md).

### Two-Step Authority Transfer
Production-grade authority management: `propose_authority` → `accept_authority` pattern prevents accidental or unauthorized authority hand-offs. Applies to both admin and compliance roles.

### Anchor Events
10 on-chain Anchor events covering all program state transitions (initialize, mint, burn, freeze, thaw, pause, unpause, collateral deposit, redeem, blacklist changes) — enables reactive off-chain indexing without polling.

### Kani Formal Verification
7 mathematical invariants proven using Rust's Kani model checker:
- Supply never underflows on burn
- Supply never overflows on mint
- max_supply cap is always enforced
- Paused mints cannot issue tokens
- Capped minters cannot exceed their cap
- Blacklisted accounts cannot receive transfers
- Collateral ratio ≥ 100% is maintained after deposit

---

## Devnet Program IDs

| Program | Program ID | Explorer |
|---------|-----------|---------|
| `sss-token` | `4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN` | [View on Explorer](https://explorer.solana.com/address/4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN?cluster=devnet) |
| `sss-transfer-hook` | `8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj` | [View on Explorer](https://explorer.solana.com/address/8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj?cluster=devnet) |

_Deployed 2026-03-14 with two-step authority transfer + Anchor events + max_supply program._

---

## Test Results

**Anchor Programs (localnet):** 19/19 passing
**TypeScript SDK:** 102/102 passing (6 test files)
**Backend (Rust/axum):** 31/31 passing
**CI:** All 4 jobs green on main ✅

---

## How to Run Locally

### Prerequisites

```bash
# Solana CLI (Agave 2.3.x)
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
# Starts a local validator, deploys both programs, runs all 19 tests
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
  SSS-3 / Authority
    ✔ Two-step authority transfer (propose + accept)
    ✔ Rejects accept from wrong address
    ✔ depositCollateral increases vault balance
    ✔ redeem burns tokens and releases collateral
    ✔ max_supply enforced on mint
    ✔ Anchor events emitted on all operations

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
Duration    ~1.5s
```

### 4. Run the backend

```bash
cd backend
cargo run
# Listens on 0.0.0.0:3000 with SQLite at /tmp/sss.db by default
```

Or with Docker (when available):
```bash
docker build -t sss-backend ./backend/
docker run -p 3000:3000 -v ./data:/data sss-backend
```

### 5. Try the REST API

```bash
# Health check
curl http://localhost:3000/api/health
# {"status":"ok"}

# Create an API key
curl -X POST http://localhost:3000/api/apikeys \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}'

# Record a mint event
curl -X POST http://localhost:3000/api/mint \
  -H "X-Api-Key: sss_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"mint":"<mint-pubkey>","amount":1000000,"recipient":"<wallet>"}'

# Get events with pagination
curl "http://localhost:3000/api/events?limit=20&offset=0" \
  -H "X-Api-Key: sss_<your-key>"

# Get compliance audit log
curl "http://localhost:3000/api/compliance/audit?limit=20&offset=0" \
  -H "X-Api-Key: sss_<your-key>"
```

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
│   REST backend (Rust/axum/SQLite) · CLI · integrations  │
│   Auth · Rate limiting · Webhooks · Audit log · Events   │
├─────────────────────────────────────────────────────────┤
│                     SDK Layer                            │
│    SolanaStablecoin · ComplianceModule (TypeScript)      │
│    Typed Anchor IDL · Preset configs (sss1/2/3Config)    │
├─────────────────────────────────────────────────────────┤
│                  On-Chain Layer                          │
│    sss-token (Anchor) · sss-transfer-hook (Anchor)       │
│    Token-2022 extensions · Anchor Events                 │
│    Two-step authority · max_supply · Collateral vault    │
└─────────────────────────────────────────────────────────┘
```

The separation is clean: on-chain programs are the source of truth. The SDK wraps them with typed methods. The backend adds authentication, rate limiting, audit logging, webhook delivery, and paginated event queries on top.

---

## What Makes This Stand Out

### 1. On-chain compliance — not a sidecar

Most stablecoin SDKs provide a compliant backend that calls a blocklist API. Our blacklist is enforced _inside Token-2022_. The transfer hook runs inside the same transaction as the transfer, checked by the Solana runtime. No backend, no oracle, no delay.

### 2. Two presets, one SDK

`sss1Config()`, `sss2Config()`, and `sss3Config()` are single-function calls that configure the entire Token-2022 mint — extensions, PDAs, hook registration, blacklist initialization. Developers switch presets by changing one argument, not by rewriting infrastructure.

### 3. Typed Anchor IDL all the way down

Both programs have full Anchor IDLs exposed to the TypeScript SDK. Method calls are type-checked. Account resolution is handled by Anchor. The developer never manually constructs transaction instructions.

### 4. Two-step authority transfer

Production systems need safe key rotation. Our `propose_authority` + `accept_authority` pattern prevents fat-finger mistakes and unauthorized authority transfers — the new authority must sign to confirm. This applies to both `admin` and `compliance` roles independently.

### 5. Anchor Events for observability

All 10 critical program state transitions emit Anchor events. Indexers, backends, and dashboards can subscribe to `InitializeEvent`, `MintEvent`, `BurnEvent`, `FreezeEvent`, `ThawEvent`, `PauseEvent`, `UnpauseEvent`, `CollateralDepositEvent`, `RedeemEvent`, and `BlacklistChangeEvent` — no polling required.

### 6. Formal verification with Kani

7 mathematical invariants are proven using the Kani model checker (`cargo kani`). This goes beyond tests — it's a machine-verified proof that the logic is correct for all possible inputs, not just the ones we thought to test.

### 7. SSS-3 full specification + partial on-chain implementation

The SSS-3 spec demonstrates how Solana's Token-2022 stack can support a trustless, oracle-free, privacy-preserving stablecoin. The `deposit_collateral` and `redeem` instructions are implemented on-chain. `max_supply` is enforced. Confidential transfers (ZK) are described in the spec with integration notes for the Token-2022 confidential-transfer extension.

### 8. Backend with pagination, webhooks, and rate limiting

The Rust/axum backend provides:
- API key auth with `sss_` prefixed keys
- Per-key rate limiting with `Retry-After` header
- Webhook delivery with event filtering
- Paginated `/api/events` and `/api/compliance/audit` endpoints
- SQLite (zero-dependency production storage)

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Three-layer system architecture |
| [SSS-1.md](./SSS-1.md) | Minimal preset specification |
| [SSS-2.md](./SSS-2.md) | Compliant preset specification |
| [SSS-3.md](./SSS-3.md) | Trustless collateral-backed reference design + implementation |
| [on-chain-sdk-core.md](./on-chain-sdk-core.md) | `SolanaStablecoin` SDK reference |
| [compliance-module.md](./compliance-module.md) | `ComplianceModule` SDK reference (SSS-017) |
| [transfer-hook.md](./transfer-hook.md) | On-chain transfer-hook program reference |
| [api.md](./api.md) | REST API reference (with pagination) |
| [devnet-deploy.md](./devnet-deploy.md) | Devnet deployment guide |
| [anchor-program-testing.md](./anchor-program-testing.md) | Anchor test suite guide (19 tests) |
| [formal-verification.md](./formal-verification.md) | Kani formal verification guide |
| [integration-testing.md](./integration-testing.md) | Integration test guide |
| [CHANGELOG.md](../CHANGELOG.md) | Full changelog |

---

## Repository Structure

```
programs/
  sss-token/           Anchor program — core stablecoin
                       initialize, mint, burn, freeze, pause, minters
                       two-step authority, deposit_collateral, redeem
                       max_supply, 10 Anchor events
  transfer-hook/       Transfer hook — SSS-2 blacklist enforcement
sdk/
  src/
    SolanaStablecoin.ts    Core SDK class (sss1/2/3Config presets)
    ComplianceModule.ts    Compliance (blacklist + freeze/thaw)
    types.ts               Shared TypeScript types
    idl/
      sss_token.json         Anchor IDL for sss-token
      sss_transfer_hook.json Anchor IDL for transfer-hook
  tests/               102 SDK unit tests (6 files)
backend/
  src/                 Rust/axum REST server
                       auth, rate limiting, audit log, webhooks
                       paginated events + compliance audit
  Cargo.toml           SQLite via rusqlite (no Postgres dependency)
proofs/
  src/                 Kani formal verification — 7 invariants proven
docs/                  All documentation (14 documents)
.github/workflows/
  ci.yml               4 CI jobs: SDK, Backend, Anchor, Integration tests
```
