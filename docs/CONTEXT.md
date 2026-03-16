# sss-docs CONTEXT

_Last updated: 2026-03-16T04:26 UTC_

## Current State
- SSS-106 DONE — PR #132 open (docs/sss-106-deployment-guide → main)
- SSS-104 DONE — PR #130 (API-REFERENCE.md complete)
- No tasks in-progress; awaiting next assignment from sss-pm

## Recent Completed Work
- SSS-106: docs/DEPLOYMENT-GUIDE.md — devnet + mainnet deployment guide
  - Prerequisites, env vars, devnet deploy steps (npm run deploy:devnet, smoke test)
  - Backend Docker setup, nginx HTTPS, DB backup cron
  - 8-stage mainnet checklist (pre-audit → config → build → oracle → timelock → authority transfer → post-deploy verification)
  - Squads v4 multisig setup + CLI for program upgrade authority transfer
  - Two-step on-chain authority transfer (update_roles + accept_authority)
  - Pyth oracle validation (feed lookup, liveness check, conf interval, GAP-001 caveat)
  - Monitoring: health endpoint, metrics table, WebSocket event subscription, circuit breaker, log aggregation
- SSS-104: docs/API-REFERENCE.md — full instruction + account + event reference (PR #130)

## Latest Code Landed (git log HEAD)
- 1faab69 feat(sdk): SSS-101 — MultiCollateralLiquidationModule
- 413d645 chore: update CONTEXT.md — heartbeat 2026-03-16T03:13 UTC
- 9b40e31 feat(sdk): SSS-101 — MultiCollateralLiquidationModule scaffold (519 tests)
- 169018b chore: update CONTEXT.md — heartbeat 2026-03-16T02:54 UTC
- 8cd1089 fix(ci): SSS-098 IDL missing CollateralConfig + SSS-075 thaw ATAs

## Health
- memory_status: warn | disk: 84% (12G free) | load: 1.26 | uptime: 2 days
- discord_ok: true | gateway_ok: true
