#!/usr/bin/env bash
# tests/devnet/run-feature-flags.sh
#
# Runner for SSS-DEVTEST-003: Feature Flag Integration Tests
#
# Prerequisites:
#   - Solana CLI installed and configured (solana-keygen new if needed)
#   - At least 0.1 SOL on the devnet wallet (solana airdrop 1 --url devnet)
#   - Project built: anchor build
#   - Dependencies installed: npm ci
#
# Usage:
#   bash tests/devnet/run-feature-flags.sh
#   ANCHOR_WALLET=/path/to/your-wallet.json bash tests/devnet/run-feature-flags.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

echo "========================================"
echo "  SSS-DEVTEST-003: Feature Flag Tests"
echo "  Network : $ANCHOR_PROVIDER_URL"
echo "  Wallet  : $ANCHOR_WALLET"
echo "========================================"

# Sanity checks
if [ ! -f "$ANCHOR_WALLET" ]; then
  echo "❌ Wallet not found at $ANCHOR_WALLET"
  echo "   Generate one: solana-keygen new --outfile $ANCHOR_WALLET"
  exit 1
fi

if [ ! -f "$REPO_ROOT/target/idl/sss_token.json" ]; then
  echo "⚠️  IDL not found at target/idl/sss_token.json"
  echo "   Run: anchor build"
  echo "   The test will report all flags as SKIP/IDL-missing."
fi

npx ts-mocha --transpile-only -p ./tsconfig.json -t 300000 \
  tests/devnet/feature-flag-test.ts
