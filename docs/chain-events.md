# Chain Events API Reference

> **SSS-095** — Off-chain indexing for on-chain observability (implements GAP-025 MEDIUM)

The `event_log` table indexes key on-chain events ingested by the backend indexer.
The `GET /api/chain-events` endpoint exposes these events for dashboards, alerting,
and audit tooling.

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

| `event_type` | Trigger |
|---|---|
| `circuit_breaker_toggle` | Circuit breaker enabled or disabled via `FLAG_CIRCUIT_BREAKER` |
| `cdp_deposit` | Collateral deposited into a CDP position |
| `cdp_borrow` | Stablecoins borrowed against a CDP position |
| `cdp_liquidate` | CDP position liquidated |
| `oracle_params_update` | Oracle price feed parameters updated |

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

**Combined filter:**
```
GET /api/chain-events?type=cdp_deposit&address=So11111111111111111111111111111111111111112&limit=50
```

---

## Integration Notes

- Results are ordered by `created_at DESC` (newest first).
- `data` is a raw JSON string; parse it client-side for event-specific fields.
- `tx_signature` and `slot` may be `null` for synthetic/test events inserted without a live chain.
- The backend indexer is responsible for calling `Database::insert_event_log()` when
  it detects matching on-chain transactions. The endpoint itself is read-only.

---

## Related

- [`GET /api/reserves/proof`](PROOF-OF-RESERVES.md) — proof-of-reserves verification
- [`GET /api/cdp/position`](on-chain-sdk-cdp.md) — CDP position state
- [`feature-flags.md`](feature-flags.md) — `FLAG_CIRCUIT_BREAKER` (bit 0) reference
