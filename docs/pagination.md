# SSS Backend — Pagination Guide

> **Feature:** SSS-011  
> **Scope:** Offset-based pagination for `/api/events` and `/api/compliance/audit`

---

## Overview

The SSS backend uses **offset-based pagination** on the two high-volume read endpoints.
Every paginated response includes a `PageMeta` object so clients can compute total pages,
detect the end of results, and drive "load more" or cursor-style UIs without any state on the server.

---

## PageMeta Shape

Every paginated response includes one or more `PageMeta` objects:

```json
{
  "total":  120,
  "offset": 50,
  "limit":  50
}
```

| Field    | Type | Description                                          |
|----------|------|------------------------------------------------------|
| `total`  | u32  | Total number of matching records in the database     |
| `offset` | u32  | Zero-based offset used for this page                 |
| `limit`  | u32  | Page size applied to this page                       |

Use these to compute:

```
last_page  = ceil(total / limit) - 1
has_more   = offset + limit < total
next_offset = offset + limit
```

---

## `GET /api/events`

Returns mint and burn events most-recent first with **independent** pagination for each event type.

### Query Parameters

| Parameter    | Type   | Default | Max  | Description                           |
|--------------|--------|---------|------|---------------------------------------|
| `token_mint` | string | —       | —    | Filter by token-mint address          |
| `limit`      | u32    | `50`    | `500`  | Records per page (applied to both lists) |
| `offset`     | u32    | `0`     | —    | Zero-based record offset              |

### Response Shape

```json
{
  "success": true,
  "data": {
    "mint_events": [ { "...": "..." } ],
    "burn_events":  [ { "...": "..." } ],
    "mint_page": { "total": 120, "offset": 0, "limit": 50 },
    "burn_page":  { "total": 34,  "offset": 0, "limit": 50 }
  },
  "error": null
}
```

> `mint_page` and `burn_page` are independent — mint and burn have different totals and may require
> different numbers of pages to exhaust.

### Examples

```bash
# First page (default)
curl -H "X-Api-Key: $KEY" http://localhost:8080/api/events

# Page 2 (records 50–99)
curl -H "X-Api-Key: $KEY" "http://localhost:8080/api/events?offset=50&limit=50"

# All events for a specific mint, small pages
curl -H "X-Api-Key: $KEY" \
  "http://localhost:8080/api/events?token_mint=So1111...&limit=20&offset=0"
```

### Iterating All Events (pseudocode)

```typescript
let offset = 0;
const limit = 50;
let hasMore = true;

while (hasMore) {
  const res = await fetch(`/api/events?offset=${offset}&limit=${limit}`, { headers });
  const { mint_events, mint_page } = res.data;

  process(mint_events);

  hasMore = offset + limit < mint_page.total;
  offset += limit;
}
```

> Run identical loops independently for `burn_events` / `burn_page`.

---

## `GET /api/compliance/audit`

Returns audit log entries most-recent first.

### Query Parameters

| Parameter | Type   | Default | Max    | Description                                    |
|-----------|--------|---------|--------|------------------------------------------------|
| `address` | string | —       | —      | Exact-match filter on wallet/contract address  |
| `action`  | string | —       | —      | Exact-match filter on action type              |
| `limit`   | u32    | `50`    | `1000` | Records per page                               |
| `offset`  | u32    | `0`     | —      | Zero-based record offset                       |

### Response Shape

```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "uuid",
        "action": "MINT",
        "address": "So1111...",
        "details": "Minted 1000000 tokens on mint So1111...",
        "created_at": "2026-03-14T03:44:56Z"
      }
    ],
    "page": { "total": 980, "offset": 0, "limit": 50 }
  },
  "error": null
}
```

> `page.total` reflects the count **after** applying `address` and `action` filters.

### Examples

```bash
# First page (default)
curl -H "X-Api-Key: $KEY" http://localhost:8080/api/compliance/audit

# Page 2
curl -H "X-Api-Key: $KEY" "http://localhost:8080/api/compliance/audit?offset=50"

# All BLACKLIST_ADD entries, paginated
curl -H "X-Api-Key: $KEY" \
  "http://localhost:8080/api/compliance/audit?action=BLACKLIST_ADD&limit=100&offset=0"

# All entries for a specific address
curl -H "X-Api-Key: $KEY" \
  "http://localhost:8080/api/compliance/audit?address=So1111...&offset=0"
```

---

## Pagination Limits

| Endpoint               | Default limit | Max limit |
|------------------------|--------------|-----------|
| `GET /api/events`      | 50           | 500       |
| `GET /api/compliance/audit` | 50      | 1000      |

Requests with `limit` above the maximum are silently clamped to the max — no error is returned.

---

## Behaviour Notes

- **Ordering:** Always newest-first (descending `created_at`). Offset is relative to that order.
- **Consistency:** Offsets are not cursors — new records written between requests will shift subsequent pages. For strict consistency, record a `created_at` timestamp from the first page and filter by it on subsequent requests.
- **Empty results:** When `offset >= total`, `entries` (or `mint_events`/`burn_events`) will be empty arrays; `page.total` still reflects the real count.
- **No server-side state:** Pagination is stateless — pass `offset` and `limit` on every request.

---

## Related Docs

- [api.md](./api.md) — Full API reference
- [compliance-audit-log.md](./compliance-audit-log.md) — Audit log detail and action types
- [integration-testing.md](./integration-testing.md) — Running the backend test suite
