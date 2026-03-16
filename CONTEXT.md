# sss-backend CONTEXT

_Last updated: 2026-03-16T04:06 UTC_

## Current State
- SSS-105 WebSocket endpoint complete, PR #131 open → develop
- Backend: 98/98 tests passing
- No new tasks in backlog or in-progress

## SSS-105 Implementation (complete)
- `AppState.ws_tx`: `broadcast::Sender<serde_json::Value>` capacity 256
- Indexer publishes events to broadcast channel after `insert_event_log`
- `GET /api/ws/events?type=liquidation|cdp|circuit-breaker`
- Filter aliases: liquidation→cdp_liquidate, cdp→{cdp_deposit,cdp_borrow,cdp_liquidate}, circuit-breaker→circuit_breaker_toggle
- Welcome message on connect; Lag notification to slow clients
- 11 new unit tests in routes/ws_events.rs

## Previous Completed Work
- SSS-102: Liquidation history API (PR #129, merged)
- SSS-095: event indexing (chain-events endpoint + indexer)
- SSS-098: CollateralConfig PDA + API endpoints

## Open PRs
- PR #131: SSS-105 WebSocket endpoint (awaiting review)

## Blocking Issues
- SSS-078: Devnet deployment requires manual browser wallet auth — must be Khubair

## Latest Code
- feature/SSS-105-websocket-events: 98/98 tests passing
- GET /api/ws/events live
- GET /api/chain-events, GET /api/liquidations fully operational
