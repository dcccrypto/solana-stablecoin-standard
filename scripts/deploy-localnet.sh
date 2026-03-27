#!/usr/bin/env bash
# =============================================================================
# deploy-localnet.sh — Start solana-test-validator with SSS programs deployed
# =============================================================================
#
# Sets up a local validator with all three SSS programs pre-deployed so the
# chaos test suite can run without devnet airdrop rate limits.
#
# Usage:
#   ./scripts/deploy-localnet.sh          # start validator + fund wallet
#   CHAOS_PAYER_KEYPAIR=~/.config/solana/id.json npx mocha tests/chaos/*.ts
#
# Requires: solana-test-validator, solana CLI, anchor, ts-mocha
#
# Program IDs (from Anchor.toml):
#   sss_token:      AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
#   sss_transfer_hook: phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp
#   cpi_caller:     HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$REPO_ROOT/target/deploy"
KEYPAIR_PATH="${SOLANA_CLI_KEYPAIR:-$HOME/.config/solana/id.json}"
VALIDATOR_LOG="/tmp/solana-test-validator.log"
VALIDATOR_LEDGER="/tmp/solana-localnet-ledger"
RPC_URL="http://127.0.0.1:8899"

# Program IDs
SSS_TOKEN_ID="AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"
TRANSFER_HOOK_ID="phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp"
CPI_CALLER_ID="HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║    SSS Localnet Deploy — Chaos Test Infrastructure           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Kill any existing validator ────────────────────────────────────────────
if pgrep -x solana-test-validator > /dev/null 2>&1; then
  echo "⚠️  Stopping existing solana-test-validator..."
  pkill -x solana-test-validator || true
  sleep 2
fi

# ── Check program binaries ─────────────────────────────────────────────────
echo "🔍 Checking program binaries in $TARGET_DIR..."

BPF_ARGS=""
for prog in sss_token sss_transfer_hook cpi_caller; do
  SO_PATH="$TARGET_DIR/${prog}.so"
  if [ -f "$SO_PATH" ]; then
    echo "  ✅ Found: $SO_PATH"
  else
    echo "  ⚠️  Missing: $SO_PATH (run 'anchor build' first)"
    echo ""
    echo "  Hint: Run 'anchor build' to compile programs before starting localnet."
    echo "  Or download program binaries from the devnet deployment."
    echo ""
  fi
done

# ── Build BPF program args ─────────────────────────────────────────────────
build_bpf_args() {
  local args=""
  [ -f "$TARGET_DIR/sss_token.so" ]         && args="$args --bpf-program $SSS_TOKEN_ID $TARGET_DIR/sss_token.so"
  [ -f "$TARGET_DIR/sss_transfer_hook.so" ] && args="$args --bpf-program $TRANSFER_HOOK_ID $TARGET_DIR/sss_transfer_hook.so"
  [ -f "$TARGET_DIR/cpi_caller.so" ]         && args="$args --bpf-program $CPI_CALLER_ID $TARGET_DIR/cpi_caller.so"
  echo "$args"
}

BPF_ARGS=$(build_bpf_args)

# ── Start validator ────────────────────────────────────────────────────────
echo ""
echo "🚀 Starting solana-test-validator..."
echo "   Ledger: $VALIDATOR_LEDGER"
echo "   Log:    $VALIDATOR_LOG"
echo ""

# shellcheck disable=SC2086
solana-test-validator \
  --ledger "$VALIDATOR_LEDGER" \
  --reset \
  --quiet \
  $BPF_ARGS \
  > "$VALIDATOR_LOG" 2>&1 &

VALIDATOR_PID=$!
echo "   PID: $VALIDATOR_PID"
echo ""

# ── Wait for validator to be ready ────────────────────────────────────────
echo "⏳ Waiting for validator to be ready..."
MAX_WAIT=30
WAITED=0
while ! solana --url "$RPC_URL" cluster-version > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "❌ Validator did not start within ${MAX_WAIT}s. Check $VALIDATOR_LOG"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  echo -n "."
done
echo ""
echo "✅ Validator ready (${WAITED}s)"

# ── Configure Solana CLI to use localnet ──────────────────────────────────
echo ""
echo "⚙️  Configuring Solana CLI for localnet..."
solana config set --url "$RPC_URL" > /dev/null
echo "   RPC: $RPC_URL"

# ── Fund the wallet ────────────────────────────────────────────────────────
WALLET_ADDRESS=$(solana address --keypair "$KEYPAIR_PATH" 2>/dev/null || echo "")
if [ -n "$WALLET_ADDRESS" ]; then
  echo ""
  echo "💰 Funding wallet: $WALLET_ADDRESS"
  solana airdrop 100 "$WALLET_ADDRESS" --url "$RPC_URL" > /dev/null 2>&1 || true
  BALANCE=$(solana balance "$WALLET_ADDRESS" --url "$RPC_URL" 2>/dev/null || echo "unknown")
  echo "   Balance: $BALANCE"
fi

# ── Export env vars for chaos tests ───────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Localnet ready! Run chaos tests with:                       ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  export CHAOS_PAYER_KEYPAIR=$KEYPAIR_PATH"
echo "║  export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899            ║"
echo "║  export ANCHOR_WALLET=$KEYPAIR_PATH"
echo "║                                                              ║"
echo "║  npx ts-mocha -p tsconfig.json -t 1000000 \\                 ║"
echo "║    tests/chaos/accountFuzzer.ts \\                            ║"
echo "║    tests/chaos/amountFuzzer.ts \\                             ║"
echo "║    tests/chaos/sequenceFuzzer.ts \\                           ║"
echo "║    tests/chaos/concurrencyFuzzer.ts \\                        ║"
echo "║    tests/chaos/chaosRunner.ts                                 ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Validator log: $VALIDATOR_LOG"
echo "   PID: $VALIDATOR_PID (kill with: kill $VALIDATOR_PID)"
echo ""

# Export for current shell session
export CHAOS_PAYER_KEYPAIR="$KEYPAIR_PATH"
export ANCHOR_PROVIDER_URL="$RPC_URL"
export ANCHOR_WALLET="$KEYPAIR_PATH"

echo "✅ Environment variables exported for current shell."
echo "   Re-run with 'source scripts/deploy-localnet.sh' to inherit in parent shell."
