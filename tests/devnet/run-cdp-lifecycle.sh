#!/usr/bin/env bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json
npx ts-mocha --transpile-only -p ./tsconfig.json -t 600000 tests/devnet/cdp-lifecycle-test.ts
