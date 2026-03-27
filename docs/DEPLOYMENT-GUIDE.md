# SSS Deployment Guide

_Author: sss-docs | Task: SSS-106 | Date: 2026-03-16_

This guide covers end-to-end deployment of the Solana Stablecoin Standard (SSS) programs and backend API — from a local build through devnet smoke-testing to a production mainnet launch. Read [API-REFERENCE.md](./API-REFERENCE.md) for instruction-level details and [GAPS-ANALYSIS-ANCHOR.md](./GAPS-ANALYSIS-ANCHOR.md) for known gaps and open action items.

> ⚠️ **v1 Feature Stubs — Do Not Rely On In Production:**
> - **ZK credential verifier** (`zk_credential.rs`): Groth16 proof verification is **not implemented** in v1. The verifier accepts any proof shape. Do not deploy with ZK-credential-gated features unless this is replaced.
> - **Cross-chain bridge** (`bridge.rs`): The bridge is a **CPI stub** that emits events but does not enforce cross-chain collateral state. Bridge minting is not collateral-verified end-to-end.
> - **Reserve attestation**: `reserve_amount` is admin-submitted by a whitelisted keypair; the program does not independently verify vault balances. See [TRUST-MODEL.md](./TRUST-MODEL.md).
> - **`max_supply = 0` means uncapped**: Always set an explicit `max_supply` for production deployments.
> - **Upgrade authority**: Transfer BPF upgrade authority to a Squads multisig before accepting real TVL (see Section 6 — BLOCKING). Use `scripts/transfer-upgrade-authority.ts` then call `set_upgrade_authority_guard` (SSS-150) to record expected authority on-chain for continuous monitoring.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Variables](#2-environment-variables)
3. [Devnet Deployment](#3-devnet-deployment)
4. [Backend Deployment](#4-backend-deployment)
5. [Mainnet Deployment Checklist](#5-mainnet-deployment-checklist)
6. [Program Upgrade Authority Transfer to DAO Multisig](#6-program-upgrade-authority-transfer-to-dao-multisig)
7. [Oracle Feed Validation](#7-oracle-feed-validation)
8. [Monitoring and Alerting](#8-monitoring-and-alerting)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### CLI Tools

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Solana CLI (Agave) | 2.3.x | `sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.13/install)"` |
| Anchor CLI | 0.32.0 | `avm install 0.32.0 && avm use 0.32.0` |
| Rust (stable) | 1.86+ | `rustup update stable` |
| Node.js | 20+ | `nvm install 20` |
| pnpm / npm | any | `npm i -g pnpm` |
| `jq` | any | `apt install jq` / `brew install jq` |
| `gh` CLI | any | `brew install gh` / see [cli.github.com](https://cli.github.com) |

### Wallet

You need a funded Solana keypair at `~/.config/solana/id.json`.

```bash
# Generate a new keypair (skip if you already have one)
solana-keygen new --outfile ~/.config/solana/id.json

# Check your address
solana address

# Devnet: get free SOL (see Section 3)
# Mainnet: fund with real SOL before deploying (~4 SOL for all three programs)
```

### Build the Programs

```bash
git clone https://github.com/dcccrypto/solana-stablecoin-standard
cd solana-stablecoin-standard
npm install
anchor build
```

---

## 2. Environment Variables

### On-Chain / SDK

No runtime environment variables are required for the on-chain programs themselves — configuration is stored in PDAs initialized by the deployer. The Anchor CLI reads cluster from `Anchor.toml`.

### Backend API

The backend (`backend/`) is a Rust/Axum server. All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `DATABASE_URL` | `./sss.db` | Path to SQLite database file |
| `BOOTSTRAP_API_KEY` | _(unset)_ | Seed an API key on first run (one-time; remove after bootstrap) |
| `RUST_LOG` | `sss_backend=info,tower_http=info` | Log level filter |
| `RATE_LIMIT_CAPACITY` | `1000` | Token bucket capacity for rate limiting |
| `RATE_LIMIT_REFILL_MS` | `1000` | Rate limit refill interval (ms) |

**Example `.env` file for local/devnet:**

```env
PORT=8080
DATABASE_URL=./sss.db
BOOTSTRAP_API_KEY=dev-only-insecure-key-change-me
RUST_LOG=sss_backend=debug,tower_http=debug
```

**Example `.env` for mainnet production:**

```env
PORT=8080
DATABASE_URL=/data/sss.db
# BOOTSTRAP_API_KEY is NOT set in production after initial setup
RUST_LOG=sss_backend=warn,tower_http=warn
RATE_LIMIT_CAPACITY=2000
RATE_LIMIT_REFILL_MS=1000
```

> ⚠️ **Never commit `.env` to version control.** The `BOOTSTRAP_API_KEY` value becomes the first API key — rotate it immediately after bootstrapping.

---

## 3. Devnet Deployment

### 3a. Fund Your Wallet

Devnet faucets rate-limit per IP. Try in order:

```bash
# Option 1: Solana CLI airdrop
solana airdrop 2 --url devnet

# Option 2: Web faucet (no rate limit)
# https://faucet.solana.com
# Paste your address from: solana address
```

You need at least **4 SOL** to deploy all three programs (`sss-token`, `sss-transfer-hook`, `cpi-caller`). Airdrop multiple times if needed.

### 3b. Deploy

```bash
# Option A — npm script (recommended)
npm run deploy:devnet

# Option B — run the script directly
bash scripts/deploy-devnet.sh
```

The script:

1. Verifies prerequisites (`solana`, `anchor`, `node`, `jq`)
2. Switches Solana CLI to devnet (`solana config set --url devnet`)
3. Checks balance; airdrops 2 SOL if below threshold
4. Builds all programs (`anchor build`)
5. Deploys with `anchor deploy --provider.cluster devnet`
6. Writes `deploy/devnet-latest.json` with addresses and Explorer links

### 3c. Canonical Program IDs (Devnet)

| Program | ID |
|---------|----|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| `cpi-caller` | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

These IDs are stable across re-deploys as long as you use the same upgrade authority keypair.

### 3d. Smoke Test

```bash
# Fund payer with ≥0.1 SOL before running (avoids airdrop rate limits mid-test)
solana airdrop 1 --url devnet

npm run smoke:devnet
# or: npx ts-node scripts/smoke-test-devnet.ts
```

Expected output:

```
✅  Smoke Test PASSED

  Mint:       F36xJcJ1zvVLXVD64YMeiQMBM86h97kbzsSywL17xWFX
  Supply:     1000 SUSD (1000000000 raw)
  Explorer:   https://explorer.solana.com/address/...?cluster=devnet
```

---

## 4. Backend Deployment

### 4a. Local / Devnet (Docker)

```bash
cd backend

# Build and start
docker-compose up --build -d

# Check health
curl http://localhost:8080/api/health
```

The `docker-compose.yml` mounts a named volume at `/data/sss.db` so the database persists across container restarts.

### 4b. Bootstrap First API Key

On first start, set `BOOTSTRAP_API_KEY` in the environment to seed an API key:

```bash
# Pass directly to docker-compose
BOOTSTRAP_API_KEY=my-bootstrap-key docker-compose up -d

# Verify the key works
curl -H "X-Api-Key: my-bootstrap-key" http://localhost:8080/api/supply
```

After confirming it works, **remove `BOOTSTRAP_API_KEY`** from your environment / compose file and restart. From here, manage keys via the `/api/keys` endpoint.

### 4c. Production (VPS / Kubernetes)

Recommended production setup:

```
                  ┌──────────────────────┐
Internet ──► HTTPS termination (nginx / Caddy / ingress)
                  │
                  ▼
             sss-backend:8080
                  │
                  ▼
              /data/sss.db  (persistent volume, backed up hourly)
```

**Nginx example** (HTTPS termination):

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # SSE / WebSocket support
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

**Database backup** (cron, daily):

```bash
0 * * * * sqlite3 /data/sss.db ".backup '/backups/sss-$(date +\%Y\%m\%d\%H).db'"
```

---

## 5. Mainnet Deployment Checklist

Work through each item in order. Do not proceed to the next category until all items in the current category are ✅.

### 5a. Pre-Audit (Do First)

- [ ] All unit and integration tests pass: `anchor test`
- [ ] All 519+ tests green on CI (`npm run ci`)
- [ ] `GAPS-ANALYSIS-ANCHOR.md` action items reviewed; CRITICAL gaps (GAP-001 oracle fallback, GAP-002 stability fee, GAP-003 bad debt) understood and accepted or resolved
- [ ] `MAINNET-CHECKLIST.md` reviewed cover-to-cover
- [ ] Independent security audit completed (OtterSec, Sec3, Neodyme, or equivalent). Do not launch with significant TVL without an audit.
- [ ] Audit findings remediated and re-reviewed

### 5b. Configuration

- [ ] Add `[programs.mainnet]` section to `Anchor.toml`:
  ```toml
  [programs.mainnet]
  sss_token       = "<MAINNET_PROGRAM_ID>"
  sss_transfer_hook = "<MAINNET_TRANSFER_HOOK_ID>"
  cpi_caller      = "<MAINNET_CPI_CALLER_ID>"

  [provider]
  cluster = "Mainnet"
  wallet  = "~/.config/solana/id.json"
  ```
- [ ] Set Solana CLI to mainnet: `solana config set --url mainnet-beta`
- [ ] Confirm wallet address and mainnet SOL balance (need ~4 SOL):
  ```bash
  solana address && solana balance
  ```

### 5c. Build and Deploy

```bash
# Build against mainnet config
anchor build

# Verify binary sizes (must match buffer allocation)
ls -lh target/deploy/*.so

# Deploy (expensive — confirm SOL balance first)
anchor deploy --provider.cluster mainnet-beta

# Record the new program IDs
solana program show <PROGRAM_ID>
```

After deploy:

- [ ] Update `declare_id!` in `programs/sss-token/src/lib.rs` and `programs/transfer-hook/src/lib.rs` with the new mainnet IDs
- [ ] Rebuild and verify the IDs match: `anchor build && anchor keys list`
- [ ] Commit the updated `Anchor.toml` and `declare_id!` values

### 5d. Initialize On-Chain State

```bash
# Initialize config PDA (sets deployer as authority)
anchor run initialize --provider.cluster mainnet-beta

# Verify config PDA exists
solana account <CONFIG_PDA_ADDRESS>
```

### 5d-i. SSS-3 Preset: Squads Multisig Required at Initialize (SSS-147A)

> **⚠️ SSS-147A enforcement:** If you are deploying an **SSS-3 (reserve-backed)** stablecoin, the `initialize` instruction now **rejects** any deployment where `squads_multisig` is not provided. Passing `Pubkey::default()` (all zeros) is treated as absent and will fail with `RequiresSquadsForSSS3`.

**SSS-1 and SSS-2 presets are unaffected.**

#### Why?

SSS-3 stablecoins hold user collateral in a reserve vault. A single admin key is a single point of failure and a centralisation risk. Requiring a Squads v4 multisig at initialization enforces a minimum governance standard before any SSS-3 token can be deployed on-chain.

#### How to initialize an SSS-3 stablecoin

1. **Create a Squads v4 multisig first** (see [Section 6](#6-program-upgrade-authority-transfer-to-squads-multisig)).
   - Minimum recommended: 3-of-5 signers.
   - Record the multisig PDA: `<SQUADS_MULTISIG_PUBKEY>`.

2. **Pass the multisig PDA as `squads_multisig` in `InitializeParams`:**

   ```typescript
   await program.methods
     .initialize({
       preset: 3,
       decimals: 6,
       collateralMint: new PublicKey("<COLLATERAL_MINT>"),
       reserveVault: new PublicKey("<RESERVE_VAULT>"),
       maxSupply: new BN("1000000000000"), // required for SSS-3
       squadsMultisig: new PublicKey("<SQUADS_MULTISIG_PUBKEY>"), // mandatory
       // ...other params
     })
     .rpc();
   ```

3. **Verify on-chain** after initialization:
   ```bash
   # squads_multisig must not be all-zeros and FLAG_SQUADS_AUTHORITY must be set
   anchor run verify-config --provider.cluster mainnet-beta
   ```

#### Checklist

- [ ] Squads v4 multisig created with ≥ 3-of-5 threshold
- [ ] `squads_multisig` parameter passed (non-default pubkey) to `initialize`
- [ ] `FLAG_SQUADS_AUTHORITY` is set in `feature_flags` after initialization
- [ ] `config.squads_multisig` on-chain matches expected multisig PDA

### 5e. Oracle Feed Validation

See [Section 7](#7-oracle-feed-validation) for full details.

- [ ] Confirm Pyth price feed address for each collateral type
- [ ] Verify feed is live and `publish_time` is within 60 seconds
- [ ] Confirm confidence interval is acceptable (`conf / price < 1%`)
- [ ] Record feed IDs in deployment notes

### 5f. Timelock Configuration

- [ ] Set admin timelock delay to ≥24h for mainnet (48h recommended):
  ```bash
  anchor run set-timelock-delay --provider.cluster mainnet-beta -- --delay 172800
  ```
- [ ] Verify timelock delay on-chain before transferring authority

### 5g. Authority Transfer to DAO Multisig

See [Section 6](#6-program-upgrade-authority-transfer-to-dao-multisig) for full details.

- [ ] Create Squads v4 multisig (3-of-5 signers minimum)
- [ ] Transfer program upgrade authority
- [ ] Transfer `authority` (stablecoin config) via `update_roles` + `accept_authority`
- [ ] Transfer `compliance_authority` via `accept_compliance_authority`
- [ ] Confirm deployer keypair has **no remaining authority** over any program or config

### 5h. Post-Deploy Verification

```bash
# Check program is deployed
solana program show <MAINNET_PROGRAM_ID>

# Run post-deploy health check (mints 1 token, burns it, reads supply)
npm run smoke:mainnet
```

- [ ] Smoke test passes on mainnet
- [ ] API backend connected to mainnet RPC endpoint
- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] Monitoring and alerting configured (see [Section 8](#8-monitoring-and-alerting))

---

## 6. Program Upgrade Authority Transfer to Squads Multisig

> **🚨 BLOCKING — must complete before accepting any TVL on mainnet.**
> The deployer keypair must not remain as upgrade authority. A single compromised key can replace the entire program binary.

> **⚠️ Audit finding H-1 — No on-chain upgrade timelock.** Solana's BPF loader does not enforce a timelock on program upgrades. Once the multisig approves an upgrade proposal in Squads, the program is replaced immediately with no on-chain delay. The SSS admin timelock (Section 5f) applies only to `admin` instruction calls — it does **not** block BPF loader upgrades. Mitigations: (a) use a high threshold (4-of-5 or 5-of-5 for the upgrade vault), (b) set Squads execution delay ≥ 7 days for upgrade proposals, (c) record the expected upgrade authority on-chain via `set_upgrade_authority_guard` (SSS-150) and monitor for drift. See also: [SSS-4 issuers](#immutable-recommendation).

### 6a. Create a Squads v4 Multisig (Upgrade Vault)

1. Go to [app.squads.so](https://app.squads.so) (or use the Squads CLI)
2. Create a **dedicated upgrade multisig** separate from the operational multisig
3. Set threshold to 4-of-5 or 5-of-5 (higher than operational threshold)
4. Set Squads execution delay to ≥ 7 days (604800 seconds) for upgrade proposals
5. Record the multisig PDA address: `<SQUADS_MULTISIG_PUBKEY>`

### 6b. Transfer Program Upgrade Authority (Automated Script)

Use the provided script which validates the Squads account exists before transferring:

```bash
# SSS-150: Use transfer-upgrade-authority.ts (validates Squads PDA, dry-run support)

# Always run dry-run first
npx ts-node scripts/transfer-upgrade-authority.ts \
  --program <SSS_TOKEN_PROGRAM_ID> \
  --new-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair ~/.config/solana/deployer.json \
  --cluster mainnet-beta \
  --dry-run

# Execute after dry-run confirms expected output
npx ts-node scripts/transfer-upgrade-authority.ts \
  --program <SSS_TOKEN_PROGRAM_ID> \
  --new-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair ~/.config/solana/deployer.json \
  --cluster mainnet-beta

# Repeat for transfer hook
npx ts-node scripts/transfer-upgrade-authority.ts \
  --program <TRANSFER_HOOK_PROGRAM_ID> \
  --new-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair ~/.config/solana/deployer.json \
  --cluster mainnet-beta

# Verify — must show SQUADS_MULTISIG_PUBKEY as upgrade authority for both
solana program show <SSS_TOKEN_PROGRAM_ID>
solana program show <TRANSFER_HOOK_PROGRAM_ID>
```

> ⚠️ If you want an **immutable** deployment (no future upgrades), use `--final` instead of `--new-upgrade-authority`. This is irreversible.

### 6c. Record Upgrade Authority Guard On-Chain (SSS-150)

After transferring and calling `init_squads_authority`, call `set_upgrade_authority_guard` to record the expected upgrade authority in the config PDA. This enables continuous on-chain monitoring:

```typescript
// Call set_upgrade_authority_guard (authority must sign; FLAG_SQUADS_AUTHORITY must be set)
// upgrade_authority must equal config.squads_multisig
await program.methods
  .setUpgradeAuthorityGuard(new PublicKey("<SQUADS_MULTISIG_PUBKEY>"))
  .accounts({
    authority: wallet.publicKey,
    config: configPda,
  })
  .rpc();

// Verify the guard works — callable by anyone
await program.methods
  .verifyUpgradeAuthority(new PublicKey("<SQUADS_MULTISIG_PUBKEY>"))
  .accounts({ config: configPda })
  .rpc();
// Returns UpgradeAuthorityMismatch if drift detected — add to monitoring pipeline
```

### 6d. Monitoring

Set up an on-chain monitor that:
1. Calls `verify_upgrade_authority(current_bpf_upgrade_authority)` every epoch
2. Alerts immediately on `UpgradeAuthorityMismatch` error
3. Alerts on any `UpgradeAuthorityGuardSet` event that was not authorized

> <a name="immutable-recommendation"></a>**Recommendation for regulated / SSS-4 issuers:** If your stablecoin is targeting regulated use (e.g. e-money, payment token under MiCA, or any context where token holders rely on the program being unalterable), strongly consider making the program immutable at mainnet launch. This eliminates upgrade risk entirely at the cost of requiring a migration if critical bugs are found. Document this decision explicitly in your issuer disclosures.

### 6e. Transfer Stablecoin Config Authority

The `authority` and `compliance_authority` fields in the on-chain `StablecoinConfig` PDA must also be transferred. This is a **two-step** process requiring a CPI call to `update_roles` followed by `accept_authority` from the new authority.

```typescript
// Step 1: Propose authority transfer (call as current authority)
await program.methods
  .updateRoles({ newAuthority: squadsPubkey })
  .accounts({ config: configPda, authority: wallet.publicKey })
  .rpc();

// Step 2: Accept authority transfer (call as the new multisig, via Squads tx)
await program.methods
  .acceptAuthority()
  .accounts({ config: configPda, newAuthority: squadsPubkey })
  .rpc();
```

The same two-step pattern applies to `compliance_authority` via `accept_compliance_authority`.

After transfer:

```bash
# Verify config PDA shows multisig as authority
solana account <CONFIG_PDA_ADDRESS> --output json | jq '.authority'
```

---

## 7. Oracle Feed Validation

SSS uses [Pyth Network](https://pyth.network) for collateral price feeds. Before mainnet launch, validate all feeds.

### 7a. Find the Correct Feed Address

```bash
# List available Pyth feeds on mainnet
# Reference: https://pyth.network/price-feeds

# SOL/USD mainnet feed
SOL_USD_FEED="H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG"

# USDC/USD mainnet feed (for PSM collateral)
USDC_USD_FEED="Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD"
```

### 7b. Verify Feed is Live

```bash
# Using the Pyth JS client
npx ts-node - << 'EOF'
import { PythHttpClient, getPythClusterApiUrl, getPythProgramKeyForCluster } from '@pythnetwork/client';
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const pythClient = new PythHttpClient(connection, getPythProgramKeyForCluster('mainnet-beta'));

const data = await pythClient.getData();
const feed = data.productPrice.get('Crypto.SOL/USD')!;

console.log('Price:', feed.aggregate.price);
console.log('Confidence:', feed.aggregate.confidence);
console.log('Status:', feed.aggregate.status);
console.log('Publish time:', new Date(feed.aggregate.publishSlot * 400));  // ~400ms per slot
EOF
```

### 7c. Validation Checklist

- [ ] Feed address matches the [Pyth mainnet feed registry](https://pyth.network/price-feeds)
- [ ] `aggregate.status === 'trading'` (not `unknown` or `halted`)
- [ ] `publish_time` is within the last 60 seconds at time of config init
- [ ] Confidence interval ratio `conf / price < 1%`
- [ ] Feed matches the expected collateral type (e.g. SOL/USD for SOL collateral)

> ⚠️ **Known gap (GAP-001):** The current SSS on-chain program does not enforce a staleness check or confidence interval rejection. Until GAP-001 is resolved, operators must monitor feed health externally and pause the program if the oracle goes stale. See `GAPS-ANALYSIS-ANCHOR.md` for details.

### 7d. Set Feed in CollateralConfig

```typescript
await program.methods
  .updateCollateralConfig({
    oracleFeed: new PublicKey(SOL_USD_FEED),
    // ... other params
  })
  .accounts({ config: configPda, authority: wallet.publicKey })
  .rpc();
```

---

## 8. Monitoring and Alerting

### 8a. Backend Health Check

```bash
# Simple uptime check (run via cron or external monitor)
curl -sf http://localhost:8080/api/health | jq '.status'
```

Integrate with an uptime monitor (UptimeRobot, Better Uptime, or a Grafana synthetic monitor) to alert if `/api/health` is unreachable or returns non-200.

### 8b. Key Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Total minted supply | `/api/supply` | Sudden >10% change in 1 hour |
| Reserve ratio | `/api/reserves` | Falls below collateralization ratio |
| Pyth feed age | Solana RPC + Pyth client | `publish_time` > 120 seconds old |
| Backend error rate | `RUST_LOG` output / structured logs | >1% 5xx in 5 minutes |
| Disk usage | Server metrics | >85% full |
| Active CDP count | `/api/cdp` | Sudden spike (may indicate exploit) |

### 8c. On-Chain Event Monitoring

The SSS programs emit Anchor events on key actions (CDP opened/closed, liquidation, mint/burn, admin changes). Subscribe via WebSocket:

```typescript
// From docs/chain-events.md — subscribe to all SSS program events
import { Connection } from '@solana/web3.js';
const connection = new Connection('wss://api.mainnet-beta.solana.com');

connection.onLogs(
  new PublicKey(SSS_TOKEN_PROGRAM_ID),
  (logs) => {
    // Parse Anchor event data from logs.logs
    console.log('Program log:', logs.logs);
  },
  'confirmed'
);
```

Or use the backend's WebSocket endpoint (added in SSS-105):

```
ws://localhost:8080/ws/events
```

Events emitted: `MintEvent`, `BurnEvent`, `CDPOpenedEvent`, `CDPClosedEvent`, `LiquidationEvent`, `AdminActionEvent`, `CollateralDepositEvent`, `CollateralWithdrawEvent`.

### 8d. Circuit Breaker

The backend exposes a circuit breaker endpoint that pauses mint/burn operations without requiring an on-chain transaction:

```bash
# Pause all minting (admin only, requires API key with admin role)
curl -X POST http://localhost:8080/api/circuit-breaker \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "reason": "Oracle outage detected"}'
```

For a full program-level pause (on-chain), the deployer or multisig must call `pause()` via the program's admin instruction.

### 8e. Log Aggregation

Set `RUST_LOG=sss_backend=info,tower_http=info` in production and forward logs to your log aggregator (e.g. Loki + Grafana, Datadog, Papertrail).

Structured JSON logging is available by setting `RUST_LOG_FORMAT=json` (if supported by the tracing configuration).

---

## 9. Troubleshooting

### Devnet airdrop fails

```bash
# Manual airdrop via web faucet
open https://faucet.solana.com
# Paste output of: solana address

# Or try CLI multiple times
for i in 1 2 3; do solana airdrop 2 --url devnet && break; sleep 10; done
```

### `anchor: command not found`

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.0
avm use 0.32.0
anchor --version
```

### Deploy fails: "insufficient funds"

All three programs require ~4 SOL total. Airdrop multiple times or use the web faucet.

### Deploy fails: "account data too small"

The existing buffer is too small for the new binary. Extend it:

```bash
# Check current size
solana program show <PROGRAM_ID>

# Extend by 50KB
solana program extend <PROGRAM_ID> 51200
```

### Backend: "Failed to initialize database"

Check that the directory containing `DATABASE_URL` exists and is writable:

```bash
mkdir -p /data && chown app:app /data
```

### Backend returns 401 on all requests

The API key is missing or wrong. Check that `X-Api-Key` header matches a key in the database. Use `BOOTSTRAP_API_KEY` on a fresh start to seed the first key.

### Oracle feed returns stale price

Check the Pyth status dashboard at [https://pyth.network/price-feeds](https://pyth.network/price-feeds). If the feed is stale, **pause the program immediately** via the circuit breaker and on-chain `pause()` instruction. Resume only after the feed is confirmed live.

### Prometheus scraping `/api/metrics` returns 401

`/api/metrics` requires a valid `X-Api-Key` header (security audit finding E-3). Create a dedicated read-only API key for your scraper and configure it via a Kubernetes Secret or network policy:

```bash
# Create a read-only key for Prometheus
curl -s -X POST http://localhost:3000/api/admin/keys \
  -H "X-Api-Key: $BOOTSTRAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"prometheus-scraper","role":"read"}'
```

Then set the key in your Prometheus `scrape_configs`:

```yaml
scrape_configs:
  - job_name: sss-backend
    static_configs:
      - targets: ["localhost:3000"]
    metrics_path: /api/metrics
    scheme: http
    params: {}
    authorization:
      type: X-Api-Key          # custom header — use bearer_token_file workaround
    # Or use basic_auth / custom header via relabelling if your Prometheus version
    # does not support custom auth headers natively.
    # Recommended: restrict /api/metrics to the Prometheus scrape IP via network
    # policy (firewall / k8s NetworkPolicy) as an additional layer of defence.
```

> **Security note:** Never expose `/api/metrics` to the public internet without authentication. The endpoint reveals internal counters that can aid attackers in fingerprinting the deployment.

---

## Related Docs

- [API-REFERENCE.md](./API-REFERENCE.md) — Full instruction, account, and event reference
- [MAINNET-CHECKLIST.md](./MAINNET-CHECKLIST.md) — Detailed mainnet readiness audit
- [DEVNET.md](./DEVNET.md) — Devnet program IDs and smoke test results
- [GAPS-ANALYSIS-ANCHOR.md](./GAPS-ANALYSIS-ANCHOR.md) — Known on-chain gaps vs. production stablecoins
- [GAPS-ANALYSIS-BACKEND.md](./GAPS-ANALYSIS-BACKEND.md) — Backend gaps
- [GAPS-ANALYSIS-SECURITY.md](./GAPS-ANALYSIS-SECURITY.md) — Security gap analysis
