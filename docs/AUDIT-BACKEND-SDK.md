# Security Audit — Areas E & F: Backend API + SDK

**Date:** 2026-03-24  
**Auditor:** sss-backend  
**Scope:** `backend/src/`, `sdk/src/`

---

## AREA E — Backend & API Security

### E-1 [HIGH] Circuit-Breaker Endpoint Accepts Raw Keypair Over HTTP

**File:** `backend/src/routes/circuit_breaker.rs`  
**Endpoint:** `POST /api/admin/circuit-breaker`

The endpoint accepts a 64-byte ed25519 authority keypair directly in the request body (`authority_keypair` field), signs a transaction, and broadcasts it. The code itself notes this is only appropriate on "a secured network".

**Exploit scenario:** Any API key holder (not just admins) can call this endpoint. An attacker who compromises any API key can exfiltrate the private key of the authority that manages the circuit breaker — the most critical on-chain admin key. A MITM attacker on HTTP would see the key in plaintext.

**Fix:**  
1. Gate this endpoint behind an elevated auth role (e.g. a separate `admin` API key tier).
2. Never accept raw private keys over the API; use a local signer, hardware wallet, or HSM. The backend should construct and return an unsigned transaction for the caller to sign client-side.
3. Add a dedicated `admin_keys` tier to the API key model with a separate DB column/flag and enforce it in `require_api_key` middleware.

---

### E-2 [HIGH] No Role Separation — All API Keys Have Identical Privileges

**Files:** `backend/src/auth.rs`, `backend/src/routes/apikeys.rs`, `backend/src/db.rs`

All `api_keys` rows are equivalent. Any valid key can:
- Create or delete other API keys (`POST /api/admin/keys`, `DELETE /api/admin/keys/:id`)
- Blacklist or un-blacklist addresses
- Trigger the circuit breaker (see E-1)
- Manage webhooks, compliance rules, compliance audit

**Exploit scenario:** An attacker who obtains a low-privilege integration key (e.g. from a leaked SDK example) can immediately self-escalate by creating a new key, delete all other keys, or manipulate the blacklist to un-block sanctioned addresses.

**Fix:** Add a `role` column to `api_keys` (e.g. `"read"`, `"write"`, `"admin"`). Enforce role checks in each route handler or as a secondary middleware that inspects a `RequiredRole` extractor. Admin endpoints (`/api/admin/*`, circuit-breaker) must require role `"admin"`.

---

### E-3 [HIGH] /api/metrics Endpoint is Unauthenticated

**File:** `backend/src/main.rs` (lines 144-145)

```rust
// Prometheus metrics — unauthenticated scrape endpoint
.route("/api/metrics", get(get_metrics))
```
This route is added **after** the `require_api_key` middleware layer, making it publicly accessible. Prometheus metrics expose internal operational data (liquidation counts, CDP health ratios, protocol TVL, backstop balances, etc.).

**Exploit scenario:** An unauthenticated attacker can poll `/api/metrics` continuously to monitor protocol health, identify when backstop balance is low (opportunity for bad-debt attacks), or detect circuit-breaker state changes before they are public.

**Fix:** Either put `/api/metrics` behind API key auth (with scrape key injected into Prometheus config), or restrict access via network policy. At minimum, document the intentional exposure. If keeping public, strip financially sensitive data from the unauthenticated metrics.

---

### E-4 [MEDIUM] Webhook HMAC Signing is Outbound-Only — No Inbound Signature Verification

**Files:** `backend/src/webhook_dispatch.rs`, `backend/src/webhook.rs`

The backend signs outbound webhook deliveries with HMAC-SHA256 and adds `X-SSS-Signature`. However, there is **no inbound webhook ingestion path that verifies HMAC**. The indexer receives on-chain events and the backend trusts its own DB for state — but if any future inbound webhook path were added, there is no existing verification scaffolding.

More critically: **there is no replay protection on outbound webhooks** (no timestamp field in the signature payload). A subscriber who receives a `mint` event can replay it to any other subscriber URL that doesn't check timestamps.

**Exploit scenario:** An attacker who intercepts a signed webhook payload can replay it hours later. If subscribers use webhook events to trigger irreversible actions (e.g. releasing assets), this is exploitable.

**Fix:** Include a `delivered_at` unix timestamp in the signed body and document that subscribers must reject payloads older than N minutes (e.g. 5 minutes). Add `X-SSS-Timestamp` as a signed header. Provide verification helper in the SDK.

---

### E-5 [MEDIUM] DB is Sole Source of Truth for Reserve Ratios and Supply

**Files:** `backend/src/routes/supply.rs`, `backend/src/routes/reserves.rs`, `backend/src/db.rs`

`GET /api/supply` and `GET /api/reserves/proof` derive supply figures entirely from the local SQLite `mint_events` / `burn_events` tables. The reserves proof only queries devnet RPC for the on-chain token supply at query time, but the backend's own supply tracking is off-chain.

**Exploit scenario:** An attacker who can write to the SQLite DB (via a path traversal, leaked database file, or future SQL injection) can insert fake burn events to inflate `total_burned`, making circulating supply appear lower than reality — potentially making an undercollateralized protocol appear healthy. Audit log entries in the same DB can also be manipulated.

**Fix:**  
1. Cross-validate `mint_events` + `burn_events` totals against the on-chain `getTokenSupply` RPC result on every `/api/supply` or `/api/reserves/proof` call. Reject or flag discrepancies above a configurable threshold.  
2. Use a write-once audit log (append-only table with DB trigger to prevent UPDATE/DELETE), or externalize the audit log.

---

### E-6 [MEDIUM] CORS Policy is Wildcard (`allow_origin: Any`)

**File:** `backend/src/main.rs` (lines 101-104)

All origins are allowed for all methods and headers. While this may be intentional for a developer API, it means any browser page on the internet can call write endpoints (`/api/mint`, `/api/burn`, compliance mutations) using a victim's API key if it is stored in a browser context.

**Fix:** Restrict `allow_origin` to known frontend origins in production. Use environment variable `CORS_ALLOW_ORIGIN` to set the allowlist.

---

### E-7 [LOW] API Key Comparison May Be Vulnerable to Timing Side-Channels

**File:** `backend/src/db.rs` (line 515: `validate_api_key`)

The key is compared via a SQL `WHERE key = ?1` query. Depending on SQLite's comparison implementation, this may not be constant-time. While the DB lookup latency likely dwarfs any timing signal, for a cryptographic secret this is worth hardening.

**Fix:** After retrieving the stored key hash (or using a keyed HMAC prefix), use `constant_time_eq` from the `subtle` crate for the comparison.

---

### E-8 [LOW] Audit Log is Mutable — Compliance Evidence Can Be Deleted

**File:** `backend/src/db.rs`, `backend/src/routes/compliance.rs`

The `audit_log` table has no trigger or policy preventing UPDATE or DELETE. Any authenticated user can drop the SQLite file or run `DELETE FROM audit_log`. No integrity proof (e.g. chained hashes) exists.

**Fix:** Add a DB trigger `BEFORE DELETE ON audit_log` that raises an error. Periodically export audit entries to an immutable append-only store (S3 object lock, Kafka, etc.).

---

### E-9 [INFO] SSRF Guard Bypassed in Test Mode

**File:** `backend/src/routes/webhooks.rs` (lines with `#[cfg(not(test))]`)

SSRF validation is disabled in `#[cfg(test)]` builds to allow in-process test servers. This is correct for test isolation, but the pattern should be reviewed to ensure test binaries are never deployed.

**Fix:** Document this explicitly. Add a CI check that confirms the production binary is compiled without the `test` feature.

---

## AREA F — SDK Security

### F-1 [HIGH] `setCircuitBreaker` / `trigger` Requires Admin Authority — No Warning

**Files:** `sdk/src/CircuitBreakerModule.ts`, `sdk/src/FeatureFlagsModule.ts`

`CircuitBreakerModule.trigger()` and `release()` are irreversible protocol-halting operations. The method signatures accept any `AnchorProvider` with no runtime check that the wallet is actually the authority. If an SDK consumer passes the wrong provider, the RPC call will fail on-chain but only after attempting to sign and submit a transaction.

More dangerous: `FeatureFlagsModule` exports `FLAG_CIRCUIT_BREAKER = 0x80` (bit 7) for backwards compatibility, while `CircuitBreakerModule` uses `FLAG_CIRCUIT_BREAKER_V2 = 0x01` (bit 0). Using the wrong constant sets a no-op flag silently.

**Exploit scenario:** A developer using `FeatureFlagsModule.FLAG_CIRCUIT_BREAKER` (0x80) believes they are activating the circuit breaker but actually sets a different flag — the protocol is not halted during an attack.

**Fix:**  
1. Deprecate `FLAG_CIRCUIT_BREAKER` from `FeatureFlagsModule` with a `@deprecated` JSDoc pointing to `FLAG_CIRCUIT_BREAKER_V2`.  
2. Add a compile-time `@ts-expect-error` guard or runtime warning in `FeatureFlagsModule.setFlag()` if the passed flag value is `0x80` (the legacy wrong bit).
3. Add a guard in `CircuitBreakerModule.trigger()` that reads current on-chain authority and warns if `provider.wallet.publicKey` doesn't match.

---

### F-2 [HIGH] `AdminTimelockModule.proposeTimelockOp` Accepts `opKind=0` (ADMIN_OP_NONE) Silently

**File:** `sdk/src/AdminTimelockModule.ts`

`proposeTimelockOp` accepts `opKind: AdminOpKind` which includes `ADMIN_OP_NONE = 0`. Proposing a no-op timelock operation wastes SOL (rent), occupies the pending-op slot (blocking future proposals), and can be exploited to DoS the admin timelock mechanism.

**Exploit scenario:** A user accidentally passes `opKind: 0` and creates a pending no-op. The timelock delay must expire before this can be cancelled, blocking all legitimate admin operations for the delay window (default ~2 days / 432,000 slots).

**Fix:** Add a guard at the top of `proposeTimelockOp`: `if (params.opKind === ADMIN_OP_NONE) throw new SSSError('opKind ADMIN_OP_NONE is not a valid proposal')`.

---

### F-3 [MEDIUM] `CdpModule` — No Maximum Slippage Check in `borrowStable`

**File:** `sdk/src/CdpModule.ts`

`borrowStable` submits a borrow instruction without validating that the resulting health factor will remain above the liquidation threshold post-borrow. The SDK computes a `liquidationPrice` for display but does not enforce minimum collateral ratio at the SDK layer before submission.

**Exploit scenario:** A developer using `borrowStable` near the liquidation boundary may inadvertently create an immediately liquidatable position due to oracle price movement between SDK calculation and transaction confirmation.

**Fix:** Add a pre-flight check in `borrowStable` that re-fetches current oracle price and rejects the call if the projected health factor would be below `MIN_COLLATERAL_RATIO_BPS` (currently 150%, 15,000 bps) with a safety margin. Document a `minHealthFactor` parameter.

---

### F-4 [MEDIUM] `ProofOfReserves.verifyMerkleProof` Accepts Empty Proof with No Error

**File:** `sdk/src/ProofOfReserves.ts`

The `verifyMerkleProof` function reduces over `siblings` and `indices` arrays. If both arrays are empty (a trivial "proof"), the function returns the leaf hash directly as the "root" with no error. Any leaf would "verify" against a root equal to itself.

**Exploit scenario:** An attacker who can control the `proof` object supplied to `verifyMerkleProof` (e.g. from an untrusted API response) can pass `{ siblings: [], indices: [] }` and any leaf will match any root equal to that leaf — bypassing proof verification.

**Fix:** Require `siblings.length >= 1` at the start of `verifyMerkleProof`. Throw `SSSError` if the proof depth is 0.

---

### F-5 [LOW] `SSSClient` Sends API Key in Every Request Including GET Reads

**File:** `sdk/src/client.ts`

The `request()` helper adds `X-Api-Key` to all requests including read-only GETs. In browser environments with TLS downgrade or request logging, this leaks the key on every call.

**Fix:** Document that `SSSClient` should never be instantiated in untrusted browser environments with a production key. Add a `readonly: boolean` constructor option that strips the key for read-only methods, or separate `ReadSSSClient` (no key) from `AdminSSSClient` (key required).

---

### F-6 [INFO] Missing Input Validation on `ComplianceModule.addToBlacklist`

**File:** `sdk/src/ComplianceModule.ts`

`addToBlacklist(address: PublicKey)` passes the `PublicKey` directly to the Anchor method without checking it is not the zero address (`PublicKey.default` / `11111111...`). Blacklisting the system program or zero address is a no-op on-chain but could confuse off-chain indexers.

**Fix:** Add: `if (address.equals(PublicKey.default)) throw new SSSError('Cannot blacklist zero address')`.

---

## Summary Table

| ID   | Area    | Severity | Finding                                                      |
|------|---------|----------|--------------------------------------------------------------|
| E-1  | Backend | HIGH     | Circuit-breaker accepts raw keypair in request body          |
| E-2  | Backend | HIGH     | No role separation — all API keys have identical privileges  |
| E-3  | Backend | HIGH     | /api/metrics is unauthenticated                              |
| E-4  | Backend | MEDIUM   | Webhook HMAC has no replay protection (no timestamp)         |
| E-5  | Backend | MEDIUM   | DB is sole truth for supply/reserves — no on-chain cross-check |
| E-6  | Backend | MEDIUM   | Wildcard CORS allows browser-side credential leakage         |
| E-7  | Backend | LOW      | API key comparison not constant-time                         |
| E-8  | Backend | LOW      | Audit log can be deleted/tampered                            |
| E-9  | Backend | INFO     | SSRF guard disabled in test builds                           |
| F-1  | SDK     | HIGH     | Wrong FLAG constant (0x80 vs 0x01) silently bypasses circuit breaker |
| F-2  | SDK     | HIGH     | ADMIN_OP_NONE accepted in proposeTimelockOp — DoS vector     |
| F-3  | SDK     | MEDIUM   | No pre-flight collateral ratio check in borrowStable         |
| F-4  | SDK     | MEDIUM   | verifyMerkleProof passes trivially for empty proof           |
| F-5  | SDK     | LOW      | API key leaked on all SDK requests in browser environments   |
| F-6  | SDK     | INFO     | No zero-address guard in ComplianceModule.addToBlacklist     |

