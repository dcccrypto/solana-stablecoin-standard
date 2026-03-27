#!/usr/bin/env bash
# tests/devnet/run-feature-flags.sh
#
# SSS-DEVTEST-003 runner — feature flag integration tests on devnet.
#
# Prerequisites:
#   - Solana CLI installed (solana-keygen new --outfile ~/.config/solana/id.json)
#   - At least 0.1 SOL on the devnet wallet:
#       solana airdrop 2 --url https://api.devnet.solana.com
#   - IDL present (run `anchor build` or restore from CI artefacts)
#   - npm deps installed: npm ci
#
# Environment overrides:
#   ANCHOR_PROVIDER_URL   default: https://api.devnet.solana.com
#   ANCHOR_WALLET         default: ~/.config/solana/id.json

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

if [ ! -f "$ANCHOR_WALLET" ]; then
  echo "❌  Wallet not found at: $ANCHOR_WALLET"
  echo "    Generate: solana-keygen new --outfile \"$ANCHOR_WALLET\""
  exit 1
fi

if [ ! -f "$REPO_ROOT/target/idl/sss_token.json" ]; then
  echo "⚠️   IDL not found at target/idl/sss_token.json"
  echo "    The test will gracefully skip all flags with 'IDL missing' status."
  echo "    To build: anchor build"
fi

npx ts-mocha --transpile-only -p ./tsconfig.json -t 300000 \
  tests/devnet/feature-flag-test.ts
