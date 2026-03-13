# SSS — Compliance & Audit Log

> **Feature:** SSS-014  
> **Scope:** Blacklist management and audit log query API (`/api/compliance/*`)

---

## Overview

The SSS backend maintains a compliance layer with two capabilities:

1. **Blacklist** — Prevent minting to specific addresses.
2. **Audit Log** — An append-only ledger recording every compliance-relevant action.

All endpoints require a valid `X-Api-Key` header. See [authentication.md](./authentication.md) for key management.

---

## Blacklist Endpoints

### `GET /api/compliance/blacklist`

Returns all currently blacklisted addresses.

**Response**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "address": "So1111...",
      "reason": "Sanctions list match",
      "created_at": "2026-03-13T21:00:00Z"
    }
  ]
}
```

---

### `POST /api/compliance/blacklist`

Adds an address to the blacklist and records a `BLACKLIST_ADD` audit entry.

**Request body**

```json
{
  "address": "So1111...",
  "reason": "Sanctions list match"
}
```

Both fields are required. Returns `400 Bad Request` if either is empty.

**Response**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "address": "So1111...",
    "reason": "Sanctions list match",
    "created_at": "2026-03-13T21:00:00Z"
  }
}
```

---

### `DELETE /api/compliance/blacklist/:id`

Removes a blacklist entry by its `id`.

**Response**

```json
{
  "success": true,
  "data": { "removed": true, "id": "uuid" }
}
```

Returns `404 Not Found` if the entry does not exist.

---

## Audit Log Endpoint

### `GET /api/compliance/audit`

Returns a filtered, time-ordered (newest-first) list of audit entries.

#### Query Parameters

| Parameter | Type   | Default | Max  | Description                                        |
|-----------|--------|---------|------|----------------------------------------------------|
| `address` | string | —       | —    | Exact-match filter on wallet or contract address   |
| `action`  | string | —       | —    | Exact-match filter on action type (see table below)|
| `limit`   | uint   | `100`   | `1000` | Maximum number of entries to return              |

All parameters are optional. With no parameters the endpoint returns the 100 most recent entries.

#### Audit Action Types

| Action          | Triggered by                                            |
|-----------------|---------------------------------------------------------|
| `MINT`          | Successful `POST /api/mint`                             |
| `MINT_BLOCKED`  | Mint attempt rejected because recipient is blacklisted  |
| `BURN`          | Successful `POST /api/burn`                             |
| `BLACKLIST_ADD` | `POST /api/compliance/blacklist`                        |

#### Example Requests

```bash
# Last 100 entries (default)
curl -H "X-Api-Key: $KEY" http://localhost:8080/api/compliance/audit

# All entries for a specific address
curl -H "X-Api-Key: $KEY" \
  "http://localhost:8080/api/compliance/audit?address=So1111..."

# Only BLACKLIST_ADD events, newest 10
curl -H "X-Api-Key: $KEY" \
  "http://localhost:8080/api/compliance/audit?action=BLACKLIST_ADD&limit=10"

# Combined: address + action filter
curl -H "X-Api-Key: $KEY" \
  "http://localhost:8080/api/compliance/audit?address=So1111...&action=MINT_BLOCKED"
```

#### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "action": "MINT_BLOCKED",
      "address": "So1111...",
      "details": "Blocked mint of 1000 to blacklisted address",
      "created_at": "2026-03-13T21:05:00Z"
    }
  ]
}
```

Each entry contains:

| Field        | Type   | Description                                      |
|--------------|--------|--------------------------------------------------|
| `id`         | string | UUID for the audit entry                         |
| `action`     | string | One of the action types in the table above       |
| `address`    | string | The wallet or contract address involved          |
| `details`    | string | Human-readable description of the event          |
| `created_at` | string | ISO 8601 UTC timestamp                           |

---

## How the Audit Log Is Written

Audit entries are written atomically in the same request that performs the action — there is no async queue. If the database write fails, the originating action also fails (the error bubbles up as a `500`). This guarantees that every recorded action actually occurred.

The SQLite table is append-only; there are no update or delete operations on audit rows.

---

## Integration Test Coverage

Audit log filtering is exercised by `test_audit_log_filtering` in `backend/src/main.rs` (SSS-QA suite). The test verifies:

- Unfiltered query returns all entries.
- `?address=` returns only entries matching that address.
- `?action=BLACKLIST_ADD` returns only blacklist-add entries.
- `?limit=1` returns exactly one entry.

See [integration-testing.md](./integration-testing.md) for how to run the full test suite.
