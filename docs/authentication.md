# SSS Backend — Authentication & API Key Management

> **Feature:** SSS-007  
> **Scope:** `X-Api-Key` header validation and API key lifecycle via `/api/admin/keys`

---

## Overview

Every SSS backend endpoint except `GET /api/health` is protected by API key authentication. Requests must present a valid key in the `X-Api-Key` HTTP header. Invalid or missing keys are rejected with `401 Unauthorized` before the request reaches any route handler.

API keys are stored in the SQLite database and managed via the `/api/admin/keys` endpoints (which are themselves key-protected).

---

## How Authentication Works

Authentication is enforced by the `require_api_key` Axum middleware (`backend/src/auth.rs`). For every incoming request it:

1. **Skips** if the path is `/api/health` (public endpoint).
2. **Reads** the `X-Api-Key` header.
3. **Validates** the key against the database.
4. **Checks rate limit** for the validated key (see [rate-limiting.md](./rate-limiting.md)).
5. **Passes** the request to the route handler on success, or returns an error response.

The middleware is the single enforcement point — route handlers do not perform their own auth checks.

---

## Sending Authenticated Requests

Include the API key in every request header:

```
X-Api-Key: sss_yourApiKeyHere
```

### curl

```bash
curl -H "X-Api-Key: sss_yourApiKeyHere" \
     https://your-sss-backend.example.com/api/supply
```

### TypeScript SDK

The SDK handles the header automatically; pass the key once at construction:

```typescript
const client = new SSSClient("https://your-sss-backend.example.com", "sss_yourApiKeyHere");
```

### CLI

```bash
export SSS_API_KEY=sss_yourApiKeyHere
sss-token supply
```

Or pass it inline:

```bash
sss-token --key sss_yourApiKeyHere supply
```

---

## Error Responses

| Condition | Status | Body |
|---|---|---|
| `X-Api-Key` header absent | `401` | `{"success":false,"error":"Missing X-Api-Key header"}` |
| Header value is not valid UTF-8 | `400` | `{"success":false,"error":"Invalid X-Api-Key header"}` |
| Key not found in database | `401` | `{"success":false,"error":"Invalid API key"}` |
| Key valid but rate-limited | `429` | `{"success":false,"error":"Rate limit exceeded"}` (+ `Retry-After` header) |
| Database error during validation | `500` | `{"success":false,"error":"<message>"}` |

---

## Key Format

Keys are generated as UUID v4 values prefixed with `sss_`:

```
sss_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
```

When listed via `GET /api/admin/keys`, only the first 8 characters (`sss_xxxx`) are returned as `key_prefix`. The full key is returned **once** at creation time and cannot be recovered afterwards — store it securely.

---

## API Key Management Endpoints

All `/api/admin/keys` endpoints require a valid `X-Api-Key` header.

---

### `POST /api/admin/keys` — Create a key

Create a new API key.

**Request body:**

```json
{
  "label": "my-service"
}
```

`label` is optional and defaults to `"unnamed"`.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "sss_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "label": "my-service",
    "created_at": "2026-03-13T19:54:00Z"
  }
}
```

> **Important:** The `key` field is only present in this response. Copy it immediately.

---

### `GET /api/admin/keys` — List keys

List all API keys. Key values are redacted; only the first 8 characters are shown.

**Response:**

```json
{
  "success": true,
  "data": {
    "api_keys": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "label": "my-service",
        "key_prefix": "sss_a1b2",
        "created_at": "2026-03-13T19:54:00Z"
      }
    ]
  }
}
```

---

### `DELETE /api/admin/keys/:id` — Delete a key

Delete an API key by its `id`. The key becomes invalid immediately.

**Response (success):**

```json
{ "success": true, "data": { "deleted": true } }
```

**Response (not found):**

`404 Not Found`

---

## Bootstrapping

On first startup the database is empty — there are no API keys. Create the first key directly via the database or by temporarily disabling auth middleware (not recommended for production). In practice, the recommended bootstrap flow is:

1. Start the backend locally with no keys in the database.
2. Create an initial key using the SQLite CLI:

```bash
sqlite3 sss.db "INSERT INTO api_keys (id, key, label, created_at) VALUES (lower(hex(randomblob(16))), 'sss_bootstrap', 'bootstrap', datetime('now'));"
```

3. Use that bootstrap key to call `POST /api/admin/keys` and create a proper key.
4. Delete the bootstrap key.

> Future iterations may add a `--bootstrap-key` flag to the startup CLI.

---

## Security Considerations

- **Keys are secrets.** Treat them like passwords. Never commit them to source control.
- **No expiry or scopes.** All valid keys have equal access to all authenticated endpoints. Rotate keys regularly and delete ones that are no longer needed.
- **No key in URL.** Keys must be in the `X-Api-Key` header, never in query strings or URLs, to avoid accidental logging.
- **Rate limiting.** Each key has its own independent token bucket — a compromised key that is being abused can be rate-limited without affecting others. See [rate-limiting.md](./rate-limiting.md).
- **HTTPS in production.** Key values are transmitted in plain text headers; always use TLS (HTTPS) in production deployments.

---

## Implementation Notes

- **Middleware location:** `backend/src/auth.rs` — `require_api_key` async function.
- **Database methods:** `db.validate_api_key(&key)` returns `Ok(true/false)`; `db.create_api_key(&label)`, `db.list_api_keys()`, `db.delete_api_key(&id)`.
- **Key redaction:** The list endpoint trims to `key[..8]` — the prefix `sss_` plus 4 hex characters.
- **Ordering:** Auth middleware runs before rate-limit middleware; an invalid key is rejected before any rate-limit bucket is touched.
