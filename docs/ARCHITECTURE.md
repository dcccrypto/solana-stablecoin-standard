# Architecture

## Layer Model

The Solana Stablecoin Standard is organized in five layers. Each layer depends only on the one below it.

```
┌───────────────────────────────────────────────┐
│  Layer 5 — Demo (React + Phantom)             │  User-facing UI
├───────────────────────────────────────────────┤
│  Layer 4 — Backend (Express REST API)         │  Infrastructure services
├───────────────────────────────────────────────┤
│  Layer 3 — CLI + SDK (TypeScript)             │  Developer tooling
├───────────────────────────────────────────────┤
│  Layer 2 — Blacklist Hook (Anchor/Rust)       │  On-chain compliance
├───────────────────────────────────────────────┤
│  Layer 1 — Token-2022 + Extensions            │  Solana runtime
└───────────────────────────────────────────────┘
```

### Layer 1 — Token-2022

The foundation. Solana's Token-2022 program provides the mint account, token accounts, and extensions. SSS uses:

- **Mint Account**: Holds supply, decimals, authorities (mint, freeze).
- **Metadata Pointer Extension**: Points the mint to itself so name/symbol/URI are stored on-mint, eliminating the need for Metaplex.
- **Transfer Hook Extension**: Registers a program ID that Token-2022 CPIs into on every `TransferChecked`. This is how SSS-2 enforces blacklist checks.

### Layer 2 — Blacklist Hook Program

An Anchor program deployed at a known address. Token-2022 calls it during every transfer of an SSS-2 token. The program maintains:

- **Config PDA** `["config", mint]` — stores the admin authority and mint reference.
- **BlacklistEntry PDA** `["blacklist", wallet]` — one per wallet, stores a `blocked: bool` flag.
- **ExtraAccountMetaList PDA** `["extra-account-metas", mint]` — TLV-encoded list telling Token-2022 which extra accounts to resolve and pass to the hook.

On every transfer, the hook receives the source account, destination account, and the resolved extra accounts (config, source blacklist PDA, destination blacklist PDA). It unpacks the token accounts, looks up the corresponding `BlacklistEntry`, and rejects the transaction if either side is blocked.

### Layer 3 — CLI and SDK

Both produce the same on-chain transactions. The CLI is for operators (shell-based workflow with TOML config files). The SDK is for developers (programmatic TypeScript API).

**CLI flow**: `config.toml` → parse → build instructions → sign with local keypair → send to chain.

**SDK flow**: `CreateOptions` / method call → build instructions → sign with provided `Keypair` → send to chain.

Both support all operations: deploy, mint, burn, freeze, thaw, pause, unpause, set-authority, blacklist, and read operations (supply, balance, status, audit log).

### Layer 4 — Backend

An Express server that wraps the SDK and adds:

- **REST API**: All SDK operations exposed as HTTP endpoints.
- **Event Listener**: Polls `getSignaturesForAddress` for the mint, detects new transactions, dispatches to webhooks.
- **Webhook Service**: Registered endpoints receive POST notifications on events with exponential-backoff retries.
- **Structured Logging**: Pino logger with JSON output in production.

The backend is stateless — the blockchain is the source of truth. Only the webhook registry is held in memory.

### Layer 5 — Demo

A React/Vite app with Tailwind CSS and the Solana Wallet Adapter. It builds transactions client-side using `@solana/spl-token` instructions and sends them to Phantom for signing. Read operations go directly to the RPC. The backend is only used for the webhooks tab.

---

## Data Flows

### Mint Tokens (CLI)

```
Operator                CLI                  Solana
   │                     │                     │
   │  sss-token mint     │                     │
   │  <recipient> <amt>  │                     │
   │────────────────────>│                     │
   │                     │  loadConfig()       │
   │                     │  loadKeypair()      │
   │                     │  getConnection()    │
   │                     │                     │
   │                     │  createAssociatedTokenAccountIdempotent()
   │                     │────────────────────>│
   │                     │                     │ (creates ATA if needed)
   │                     │  mintTo()           │
   │                     │────────────────────>│
   │                     │                     │ (mint authority signs)
   │                     │  tx signature       │
   │                     │<────────────────────│
   │  "Minted. Tx: ..."  │                     │
   │<────────────────────│                     │
```

### Transfer with Blacklist Check (SSS-2)

```
Sender Wallet           Token-2022           Blacklist Hook
     │                       │                     │
     │  transferChecked()    │                     │
     │──────────────────────>│                     │
     │                       │  resolve extra      │
     │                       │  account metas      │
     │                       │  (config, src_bl,   │
     │                       │   dst_bl PDAs)      │
     │                       │                     │
     │                       │  CPI: execute()     │
     │                       │────────────────────>│
     │                       │                     │ unpack source/dest
     │                       │                     │ check src blacklist
     │                       │                     │ check dst blacklist
     │                       │                     │
     │                       │  OK or Error        │
     │                       │<────────────────────│
     │                       │                     │
     │  success / reject     │                     │
     │<──────────────────────│                     │
```

### Demo Mint Flow (Phantom)

```
User (Browser)          Demo App              Phantom            Solana
     │                     │                     │                  │
     │  Click "Mint"       │                     │                  │
     │────────────────────>│                     │                  │
     │                     │  buildMintTx()      │                  │
     │                     │  (ATA check + ix)   │                  │
     │                     │                     │                  │
     │                     │  sendTransaction()  │                  │
     │                     │────────────────────>│                  │
     │                     │                     │  sign popup      │
     │                     │                     │<─── user approves│
     │                     │                     │                  │
     │                     │                     │  send to RPC     │
     │                     │                     │─────────────────>│
     │                     │                     │  tx signature    │
     │                     │                     │<─────────────────│
     │                     │  confirmTransaction │                  │
     │                     │─────────────────────────────────────-->│
     │  "Minted. Tx: ..."  │                     │                  │
     │<────────────────────│                     │                  │
```

---

## Security Model

### Authority Separation

SSS encourages separating authorities across different keypairs:

| Authority | Controls | Can be revoked? |
|-----------|----------|----------------|
| **Mint Authority** | Creating new supply | Yes (`set-authority mint none`) |
| **Freeze Authority** | Freezing/thawing individual token accounts | Yes |
| **Metadata Authority** | Updating on-mint metadata | Yes |
| **Blacklist Admin** (SSS-2) | Adding/removing wallets from the blacklist | Changeable via Config PDA |
| **Pause Authority** (optional) | Halting all transfers | Yes |
| **Permanent Delegate** (optional) | Recovering/seizing tokens from any account | Cannot be revoked once set |

### On-Chain Enforcement

Blacklist checks are enforced at the protocol level by Token-2022. There is no way to bypass the transfer hook — every `TransferChecked` instruction triggers the CPI to the blacklist program. Direct `Transfer` (non-checked) is not supported by Token-2022 mints with a transfer hook.

### Backend Security

The backend is stateless and holds no secrets beyond the authority keypair (configured via environment variable). In production:

- Run behind a reverse proxy (nginx, Cloudflare) with TLS.
- Add API key authentication or OAuth at the proxy layer.
- Store keypairs in a secrets manager (AWS Secrets Manager, HashiCorp Vault).
- Use the `SOLANA_KEYPAIR_BASE64` env var for containerized deployments instead of file paths.

### Demo Security

The demo never touches private keys. All signing happens in the Phantom wallet extension. The connected wallet must be the relevant authority (mint authority to mint, freeze authority to freeze, etc.).
