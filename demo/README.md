# SSS Demo — React Frontend

An interactive React demo that connects to Phantom wallet and exposes all Solana Stablecoin Standard operations through a clean UI. Built with **Vite + React + Tailwind CSS** and the Solana Wallet Adapter.

---

## Features

| Page | Operations |
|------|-----------|
| **Dashboard** | Token status, supply, mint/freeze authorities |
| **Accounts** | Check balances, view ATAs |
| **Mint & Burn** | Mint to recipient, burn from your ATA |
| **Compliance** | Blacklist add/remove/check (SSS-2) |
| **Webhooks** | Register/manage webhook subscriptions |
| **Audit Log** | Browse recent transactions for the mint |
| **Settings** | Configure RPC, mint address, hook program |

All write operations open Phantom for user signature (client-side transaction building). No server-side keypairs needed.

---

## Quick Start

```bash
cd demo
npm install
npm run dev
```

Opens at `http://localhost:5173`. Connect your Phantom wallet, then configure the mint address in Settings.

### With Backend (optional, for webhooks)

```bash
# Terminal 1 — backend
cd backend && npm install && npm run dev

# Terminal 2 — demo
cd demo && npm run dev
```

---

## Configuration

All configuration is done in the **Settings** page:

| Setting | Description |
|---------|-------------|
| **RPC URL** | Solana JSON-RPC endpoint (devnet/mainnet) |
| **Mint Address** | The deployed stablecoin mint (base58) |
| **Hook Program ID** | Blacklist transfer hook program ID (SSS-2 only) |
| **Backend URL** | Backend service URL (for webhooks) |

---

## Tech Stack

- **React 18** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **@solana/wallet-adapter-react** for wallet connection
- **@solana/spl-token** for token operations
- **@solana/web3.js** for Solana RPC

---

## Build for Production

```bash
npm run build
npm run preview   # local preview of the build
```

Output is in `dist/`.
