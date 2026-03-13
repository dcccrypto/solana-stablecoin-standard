#!/usr/bin/env bash
# deploy-devnet.sh — Build and deploy SSS programs to Solana devnet
# Usage: bash scripts/deploy-devnet.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
DEPLOY_DIR="$ROOT/deploy"
DEPLOY_OUT="$DEPLOY_DIR/devnet-latest.json"

WALLET="${SOLANA_KEYPAIR:-$HOME/.config/solana/id.json}"

echo "┌──────────────────────────────────────────────────────────────┐"
echo "│   Solana Stablecoin Standard — Devnet Deployment (SSS-013)   │"
echo "└──────────────────────────────────────────────────────────────┘"
echo ""

# ── 1. Prerequisite checks ──────────────────────────────────────────────────

check_bin() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌  '$1' not found. Please install it and re-run." >&2
    exit 1
  fi
}

check_bin solana
check_bin anchor
check_bin node
check_bin jq

echo "✅  Prerequisites OK"

# ── 2. Switch to devnet ─────────────────────────────────────────────────────

echo ""
echo "🌐  Switching to devnet..."
solana config set --url devnet --keypair "$WALLET" >/dev/null

WALLET_ADDR=$(solana address --keypair "$WALLET")
echo "    Wallet: $WALLET_ADDR"

# ── 3. Check / airdrop SOL balance ──────────────────────────────────────────

echo ""
echo "💰  Checking balance..."
BALANCE=$(solana balance --keypair "$WALLET" | awk '{print $1}')
echo "    Balance: $BALANCE SOL"

# Use awk for float comparison (bash can't compare floats natively)
NEEDS_AIRDROP=$(awk "BEGIN { print ($BALANCE < 2) ? 1 : 0 }")
if [ "$NEEDS_AIRDROP" -eq 1 ]; then
  echo "    Balance < 2 SOL — requesting airdrop..."
  solana airdrop 2 --keypair "$WALLET" || {
    echo "⚠️   Airdrop failed (devnet faucet may be rate-limited). Continuing anyway..."
  }
fi

# ── 4. Anchor build ─────────────────────────────────────────────────────────

echo ""
echo "🔨  Building programs..."
cd "$ROOT"
anchor build 2>&1 | tail -5
echo "✅  Build complete"

# ── 5. Anchor deploy ────────────────────────────────────────────────────────

echo ""
echo "🚀  Deploying to devnet..."
DEPLOY_LOG=$(anchor deploy --provider.cluster devnet 2>&1)
echo "$DEPLOY_LOG" | tail -20

# ── 6. Parse deployed addresses ─────────────────────────────────────────────

echo ""
echo "📝  Capturing deployed program IDs..."

SSS_TOKEN_ID=$(echo "$DEPLOY_LOG" | grep -oP 'sss.token.*?(\b[1-9A-HJ-NP-Za-km-z]{43,44}\b)' | grep -oP '\b[1-9A-HJ-NP-Za-km-z]{43,44}\b' | tail -1 || echo "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN")
SSS_HOOK_ID=$(echo "$DEPLOY_LOG" | grep -oP 'transfer.hook.*?(\b[1-9A-HJ-NP-Za-km-z]{43,44}\b)' | grep -oP '\b[1-9A-HJ-NP-Za-km-z]{43,44}\b' | tail -1 || echo "8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj")

# Fallback: read from Anchor.toml
if [ -z "$SSS_TOKEN_ID" ]; then
  SSS_TOKEN_ID=$(grep -A1 '\[programs.devnet\]' Anchor.toml | grep sss_token | awk -F'"' '{print $2}')
fi
if [ -z "$SSS_HOOK_ID" ]; then
  SSS_HOOK_ID=$(grep 'sss_transfer_hook' Anchor.toml | head -1 | awk -F'"' '{print $2}')
fi

mkdir -p "$DEPLOY_DIR"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$DEPLOY_OUT" <<EOF
{
  "cluster": "devnet",
  "deployedAt": "$TIMESTAMP",
  "wallet": "$WALLET_ADDR",
  "programs": {
    "sssToken": "$SSS_TOKEN_ID",
    "transferHook": "$SSS_HOOK_ID"
  },
  "explorerLinks": {
    "sssToken": "https://explorer.solana.com/address/$SSS_TOKEN_ID?cluster=devnet",
    "transferHook": "https://explorer.solana.com/address/$SSS_HOOK_ID?cluster=devnet"
  }
}
EOF

echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│                     Deployment Summary                        │"
echo "└──────────────────────────────────────────────────────────────┘"
echo ""
jq '.' "$DEPLOY_OUT"
echo ""
echo "✅  Deployed! Manifest saved to: $DEPLOY_OUT"
echo ""
echo "👉  Next: bash scripts/smoke-test-devnet.sh"
