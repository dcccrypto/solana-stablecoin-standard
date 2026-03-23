# SSS Event Schema v1

> **Status:** Stable · Version: 1 · Updated: 2026-03-23

This document defines the canonical on-chain event schema emitted by all SSS
stablecoin programs. Any indexer (Helius, Shyft, Triton, custom) that consumes
SSS program transactions can use this schema to decode and classify events.

---

## Overview

SSS programs emit events as Anchor `Program log:` lines and as `Program data:`
base64-encoded discriminator payloads. All structured events are wrapped in a
standard envelope before delivery to registered webhooks.

---

## Envelope (Webhook Delivery)

Every webhook POST body contains this envelope:

```json
{
  "schema_version": "1",
  "event_type": "<EventName>",
  "data": { /* event-specific fields */ },
  "signature": "<base58-tx-signature>",
  "slot": 123456789,
  "observed_at": "2026-03-23T18:00:00Z"
}
```

| Field            | Type    | Description                                           |
|------------------|---------|-------------------------------------------------------|
| `schema_version` | string  | Always `"1"` for this version                         |
| `event_type`     | string  | Canonical event name (see table below)                |
| `data`           | object  | Event-specific payload fields                         |
| `signature`      | string? | Base58 transaction signature (set by indexer)         |
| `slot`           | u64?    | Slot number (set by indexer)                          |
| `observed_at`    | string  | ISO-8601 UTC timestamp                                |

---

## Event Types

| Event Type                | Emitted By          | Description                                      |
|---------------------------|---------------------|--------------------------------------------------|
| `MintExecuted`            | sss-token           | Stablecoins minted to recipient                  |
| `BurnExecuted`            | sss-token           | Stablecoins burned from sender                   |
| `CDPOpened`               | sss-token           | New CDP position opened                          |
| `CDPRepaid`               | sss-token           | CDP debt partially or fully repaid               |
| `CDPLiquidated`           | sss-token           | CDP position liquidated                          |
| `CircuitBreakerTriggered` | sss-token           | Circuit breaker feature flag toggled             |
| `ReserveAttestation`      | sss-token           | On-chain proof-of-reserve attestation recorded   |
| `OracleParamsUpdated`     | sss-token           | Oracle configuration changed                     |
| `StabilityFeeAccrued`     | sss-token           | Stability fee accrued on a CDP position          |
| `CollateralRegistered`    | sss-token           | New collateral type registered                   |
| `CollateralConfigUpdated` | sss-token           | Collateral parameters updated                    |
| `TransferHookExecuted`    | sss-transfer-hook   | Transfer hook executed for a token transfer      |
| `SpendPolicyUpdated`      | sss-token           | Spend policy configuration updated               |

---

## Event Discriminators (Program data: lines)

Anchor emits `Program data: <base64>` lines where the first 8 bytes are
`sha256("event:<EventName>")[..8]`.

| Event Type                | Discriminator (hex)         |
|---------------------------|-----------------------------|
| `MintExecuted`            | `e4 45 a5 2e 51 cb 9a 1d`   |
| `BurnExecuted`            | `1c 9b 02 ed 3f 7b d4 3b`   |
| `CDPOpened`               | `a8 3c 50 1e f5 2c d8 6a`   |
| `CDPRepaid`               | `7d 4f b1 22 cc 09 a0 5e`   |
| `CDPLiquidated`           | `3b 7e 1d 40 9f 81 6c b2`   |
| `CircuitBreakerTriggered` | `f1 2d 8e 03 47 ac b9 5c`   |
| `ReserveAttestation`      | `2a c1 77 4e 0b d5 e3 91`   |
| `OracleParamsUpdated`     | `6e 91 3f b8 55 2d 04 c7`   |
| `StabilityFeeAccrued`     | `84 0f 6b d9 1c e2 58 af`   |
| `CollateralRegistered`    | `d3 5a 87 16 4a 79 b0 f3`   |
| `CollateralConfigUpdated` | `9c 63 2e f7 38 1b d1 85`   |
| `TransferHookExecuted`    | `b7 2f 54 0c 61 e5 9d 27`   |
| `SpendPolicyUpdated`      | `4d 88 c3 71 06 a4 f2 be`   |

---

## Event Field Reference

### MintExecuted
```json
{ "amount": 1000000, "recipient": "<pubkey>", "mint": "<pubkey>" }
```

### BurnExecuted
```json
{ "amount": 500000, "sender": "<pubkey>", "mint": "<pubkey>" }
```

### CDPOpened
```json
{ "collateral": "SOL", "collateral_amount": 2000000000, "debt": 100000000, "owner": "<pubkey>" }
```

### CDPLiquidated
```json
{ "position": "<pubkey>", "liquidator": "<pubkey>", "collateral_seized": 2000000000, "debt_repaid": 100000000 }
```

### CircuitBreakerTriggered
```json
{ "feature": 3, "enabled": false, "authority": "<pubkey>" }
```

### ReserveAttestation
```json
{ "total_collateral": 9999999, "total_supply": 9000000, "ratio_bps": 11111, "timestamp": 1711111111 }
```

---

## HMAC Signature Verification

When a webhook is registered with a `secret_key`, each delivery includes:

```
X-SSS-Signature: sha256=<hex>
```

Verify in Node.js:
```js
const crypto = require('crypto');
const sig = crypto.createHmac('sha256', SECRET_KEY)
  .update(rawBody)
  .digest('hex');
assert(`sha256=${sig}` === req.headers['x-sss-signature']);
```

---

## Changelog

| Version | Date       | Changes                                         |
|---------|------------|-------------------------------------------------|
| 1       | 2026-03-23 | Initial release — 13 event types, HMAC signing |
