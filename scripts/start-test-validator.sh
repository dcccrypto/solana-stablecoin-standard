#!/usr/bin/env bash
# Start solana-test-validator with all SSS programs pre-deployed.
# Usage: ./scripts/start-test-validator.sh [--reset]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/target/deploy"

# Check programs are built
for so in sss_token.so sss_transfer_hook.so cpi_caller.so; do
  if [[ ! -f "$DEPLOY_DIR/$so" ]]; then
    echo "ERROR: $DEPLOY_DIR/$so not found. Run 'anchor build' first."
    exit 1
  fi
done

RESET_FLAG=""
if [[ "${1:-}" == "--reset" ]]; then
  RESET_FLAG="--reset"
fi

echo "Starting solana-test-validator with SSS programs..."
exec solana-test-validator \
  --bpf-program AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat "$DEPLOY_DIR/sss_token.so" \
  --bpf-program phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp "$DEPLOY_DIR/sss_transfer_hook.so" \
  --bpf-program HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof "$DEPLOY_DIR/cpi_caller.so" \
  $RESET_FLAG
