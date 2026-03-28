# Chain Events API Reference

> **SSS-095** — Off-chain indexing for on-chain observability (implements GAP-025 MEDIUM)

The `event_log` table indexes key on-chain events ingested by the backend indexer.
The `GET /api/chain-events` endpoint exposes these events for dashboards, alerting,
and audit tooling.

---

## Indexer Architecture

The backend runs a **background Tokio task** (`backend/src/indexer.rs`) that polls
the Solana RPC every 30 seconds for new transactions on the two SSS program addresses:

| Label | Program Address |
|---|---|
| `sss-token` | `2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

### Poll loop

1. **`getSignaturesForAddress`** — fetches up to 50 new signatures since the last
   processed signature (stored in `indexer_state` table so restarts are safe).
2. **`getTransaction`** — fetches full transaction data for each new signature.
3. **Log parsing** — scans `Program log: <EventName> { ... }` lines and
   `Program data: <base64>` lines (discriminator fallback) to detect known SSS events.
4. **Insert** — calls `Database::insert_event_log()` for each detected event.
5. **Cursor update** — persists the latest processed signature via
   `set_indexer_cursor()` before sleeping.

### Cursor / Replay Safety

The `indexer_state` table stores one row per program (`sss-token`, `sss-transfer-hook`)
holding `last_signature`. On restart the indexer resumes from the last known cursor,
preventing duplicate inserts.

### Configuration

| Env Var | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | Devnet endpoint | Solana JSON-RPC URL (set to mainnet/testnet as needed) |

The indexer is started automatically in `main()` via `indexer::spawn_indexer(state.clone())`
before the Axum HTTP server begins accepting connections.

---

## Database Schema

```sql
CREATE TABLE event_log (
  id            TEXT PRIMARY KEY,   -- UUID v4
  event_type    TEXT NOT NULL,       -- see Event Types below
  address       TEXT NOT NULL,       -- token mint / CDP position / program address
  data          TEXT NOT NULL,       -- JSON blob with event-specific fields
  tx_signature  TEXT,                -- Solana transaction signature (nullable)
  slot          INTEGER,             -- Solana slot number (nullable)
  created_at    TEXT NOT NULL        -- RFC-3339 timestamp (UTC)
);

CREATE INDEX idx_event_log_type    ON event_log(event_type);
CREATE INDEX idx_event_log_address ON event_log(address);
```

---

## Event Types

| `event_type` | Anchor Event Name | Trigger |
|---|---|---|
| `circuit_breaker_toggle` | `CircuitBreakerToggled` | Circuit breaker enabled or disabled via `FLAG_CIRCUIT_BREAKER` |
| `cdp_deposit` | `CollateralDeposited` | Collateral deposited into a CDP position |
| `cdp_borrow` | `StablecoinsIssued` | Stablecoins borrowed against a CDP position |
| `cdp_liquidate` | `PositionLiquidated` | CDP position liquidated |
| `oracle_params_update` | `OracleParamsUpdated` | Oracle price feed parameters updated |
| `stability_fee_accrual` | `StabilityFeeAccrued` | Stability fee accrued on a CDP position |

---

## GET /api/chain-events

Returns a paginated list of indexed on-chain events, newest first.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | Filter by `event_type` (e.g. `circuit_breaker_toggle`) |
| `address` | string | — | Filter by token mint, CDP position, or program address |
| `limit` | integer | `100` | Maximum results to return (max: `1000`) |

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "event_type": "cdp_deposit",
      "address": "So11111111111111111111111111111111111111112",
      "data": "{\"amount\": 1000000, \"collateral_type\": \"SOL\"}",
      "tx_signature": "5KmX...abc",
      "slot": 312456789,
      "created_at": "2026-03-15T22:08:25Z"
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID v4 row identifier |
| `event_type` | string | One of the event types listed above |
| `address` | string | Token mint / CDP position / program address |
| `data` | string | JSON string with event-specific payload fields |
| `tx_signature` | string \| null | Solana transaction signature |
| `slot` | integer \| null | Solana slot at which event occurred |
| `created_at` | string | RFC-3339 UTC timestamp of indexer ingestion |

### Examples

**All circuit breaker events:**
```
GET /api/chain-events?type=circuit_breaker_toggle
```

**All events for a specific mint:**
```
GET /api/chain-events?address=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

**Latest 10 CDP liquidations:**
```
GET /api/chain-events?type=cdp_liquidate&limit=10
```

**Stability fee accruals for a position:**
```
GET /api/chain-events?type=stability_fee_accrual&address=<position_address>&limit=50
```

**Combined filter:**
```
GET /api/chain-events?type=cdp_deposit&address=So11111111111111111111111111111111111111112&limit=50
```

---

## Integration Notes

- Results are ordered by `created_at DESC` (newest first).
- `data` is a raw JSON string; parse it client-side for event-specific fields.
- `tx_signature` and `slot` may be `null` for synthetic/test events inserted without a live chain.
- The indexer polls every **30 seconds**; expect up to ~30s latency between an on-chain
  event and its appearance in the API.
- The `SOLANA_RPC_URL` env var must point to the correct cluster (devnet/mainnet).
  Mismatched RPC URL means no events will be indexed.

---

## Related

- [`GET /api/reserves/proof`](PROOF-OF-RESERVES.md) — proof-of-reserves verification
- [`GET /api/cdp/position`](on-chain-sdk-cdp.md) — CDP position state
- [`feature-flags.md`](feature-flags.md) — `FLAG_CIRCUIT_BREAKER` (bit 0) reference
- [`on-chain-sdk-cdp.md`](on-chain-sdk-cdp.md) — `StabilityFeeAccrued` event context
