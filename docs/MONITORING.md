# SSS Monitoring & Alerting Guide (SSS-139)

## Overview

The SSS backend ships an invariant monitoring bot that runs as background tasks inside the API server.
It continuously checks on-chain state invariants, exports Prometheus metrics, and fires alerts to Discord, PagerDuty, and an on-chain AlertRecord log.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              sss-backend process            │
│                                             │
│  ┌──────────────────┐  ┌─────────────────┐ │
│  │ InvariantChecker │  │ MetricCollector │ │
│  │  (every 4s)      │  │  (every 15s)    │ │
│  └────────┬─────────┘  └────────┬────────┘ │
│           │                     │          │
│           ▼                     ▼          │
│  ┌──────────────────┐   ┌──────────────┐  │
│  │  AlertManager    │   │  AtomicI64   │  │
│  │  · Discord hook  │   │  metrics     │  │
│  │  · PagerDuty     │   └──────────────┘  │
│  │  · AlertRecord   │                     │
│  │    (event_log)   │                     │
│  └──────────────────┘                     │
│                                           │
│  GET /api/metrics  → Prometheus scrape    │
│  GET /api/alerts   → AlertRecord history  │
│  POST /api/alerts  → External alert ingest│
└─────────────────────────────────────────────┘
```

---

## Invariants Checked

| Invariant | Description | Severity |
|---|---|---|
| `supply_consistency` | Circulating supply can never be negative (burned ≤ minted) | CRITICAL |
| `reserve_ratio` | Backstop balance / circulating supply ≥ 1.0 (100%) | CRITICAL |
| `sanctioned_transactions` | No blacklisted address appears in MintExecuted/BurnExecuted events | CRITICAL |
| `circuit_breaker` | If peg deviation > 500bps, circuit breaker must be halted | WARNING |

---

## Prometheus Metrics

Exposed at: `GET /api/metrics` (unauthenticated — safe for Prometheus scrapers)

| Metric | Type | Description |
|---|---|---|
| `sss_supply_total` | gauge | Circulating supply (lamports) |
| `sss_reserve_ratio` | gauge | Backstop / circulating supply ratio |
| `sss_active_cdps` | gauge | CDPs opened but not yet liquidated |
| `sss_peg_deviation_bps` | gauge | Peg deviation in basis points (from latest oracle event) |

### Example Prometheus config

```yaml
scrape_configs:
  - job_name: sss-backend
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: /api/metrics
    scrape_interval: 15s
```

---

## Grafana Dashboard

A pre-built Grafana dashboard is provided at `monitoring/grafana-dashboard.json`.

**Import steps:**
1. Open Grafana → **Dashboards** → **Import**
2. Upload `monitoring/grafana-dashboard.json`
3. Select your Prometheus datasource
4. Click **Import**

The dashboard includes panels for:
- Total circulating supply over time
- Reserve ratio with a 100% minimum threshold line
- Active CDP count
- Peg deviation in bps with circuit breaker threshold line
- Recent alert history (AlertRecord count)

---

## Alert Channels

### Discord Webhook

Set the environment variable:

```bash
ALERT_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
```

Alerts are formatted as:
```
🚨 SSS Alert [CRITICAL] `supply_consistency`: burned (1500) > minted (1000): circulating supply would be negative
```

### PagerDuty

Set the environment variable:

```bash
PAGERDUTY_ROUTING_KEY=<your-integration-key>
```

Alerts trigger PagerDuty Events v2 API with dedup keys to prevent duplicate pages for the same invariant on the same day.

### AlertRecord (On-Chain Transparency Log)

All alerts are recorded in the backend's `event_log` table with `event_type=AlertRecord`.

Query via API:
```bash
GET /api/alerts
GET /api/alerts?invariant=reserve_ratio&limit=50
```

External systems can also submit alerts:
```bash
POST /api/alerts
Content-Type: application/json
X-Api-Key: <key>

{
  "invariant": "custom_check",
  "detail": "External system detected anomaly",
  "severity": "warning"
}
```

---

## Environment Variables Summary

| Variable | Required | Description |
|---|---|---|
| `ALERT_DISCORD_WEBHOOK_URL` | No | Discord webhook URL for alert delivery |
| `PAGERDUTY_ROUTING_KEY` | No | PagerDuty Events v2 integration key |
| `DATABASE_URL` | No (default: `./sss.db`) | SQLite database path |
| `PORT` | No (default: `8080`) | HTTP server port |

---

## Tuning

Polling intervals and thresholds are constants in `backend/src/monitor/`:

| Constant | File | Default | Description |
|---|---|---|---|
| `POLL_INTERVAL_SECS` | `invariant_checker.rs` | 4s | Invariant check frequency (~10 slots) |
| `MIN_RESERVE_RATIO` | `invariant_checker.rs` | 1.0 | Minimum backstop ratio |
| `CIRCUIT_BREAKER_BPS` | `invariant_checker.rs` | 500 | Peg deviation threshold |
| `SCRAPE_INTERVAL_SECS` | `metric_collector.rs` | 15s | Prometheus metric collection frequency |
