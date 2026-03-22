# Security Audit — SSS-114: SDK + Backend Attack Surface
**Auditor:** sss-qa  
**Date:** 2026-03-22  
**Scope:** TypeScript SDK (`sdk/src/`), Rust backend (`backend/src/`), on-chain programs (`programs/sss-token/src/instructions/pbs.rs`, `apc.rs`)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 2     |
| MEDIUM   | 2     |
| LOW      | 3     |
| INFO     | 2     |

---

## HIGH

### H-001 — IDL Staleness: PBS + APC Instructions Missing from Bundled IDL
**File:** `sdk/src/idl/sss_token.json`  
**Description:** The bundled IDL does not include any of the 8 instructions added in SSS-109/SSS-110:
- `commit_probabilistic`, `prove_and_resolve`, `partial_resolve`, `expire_and_refund`
- `open_channel`, `submit_work_proof`, `propose_settle`, `countersign_settle`, `dispute`, `force_close`

Any tool or consumer using the IDL directly (e.g. Anchor client codegen, explorers, type generators) will fail to decode these transactions and will silently drop them. If a future SDK version auto-generates instruction builders from the IDL, the stale IDL will produce incorrect instruction data with no compile-time warning.

**Fix:** Regenerate IDL with `anchor build` on current program source and replace `sdk/src/idl/sss_token.json`. See fix commit in this PR.

---

### H-002 — SSRF: Webhook URL Registered Without Scheme/Host Validation
**File:** `backend/src/routes/webhooks.rs`  
**Description:** `register_webhook` accepts any non-empty string as a webhook URL. An authenticated API client can register `http://169.254.169.254/latest/meta-data/` (AWS IMDS), `http://localhost:5432/`, or other internal network targets. The `webhook_dispatch` fires HTTP POSTs to all registered URLs with the full event payload, making every mint/burn event a trigger for SSRF.

**Fix:** Validate that the URL (a) parses as a valid URL, (b) uses `https` or `http` scheme only, and (c) resolves to a public IP (reject RFC-1918 / loopback / link-local). See fix in `backend/src/routes/webhooks.rs`.

---

## MEDIUM

### M-001 — APC SDK: `openChannel` Allows Zero-Address Counterparty
**File:** `sdk/src/AgentPaymentChannelModule.ts`  
**Description:** `openChannel` does not validate that `counterparty` is a non-zero pubkey. `PublicKey.default` (all zeros) is accepted and sent to the program. On-chain, the program also does not verify `counterparty != Pubkey::default()` (confirmed in `programs/sss-token/src/instructions/apc.rs`). A channel opened with a zero-address counterparty can never be settled cooperatively, leaving funds locked until `force_close` timeout.

**Fix (SDK):** Add `if (counterparty.equals(PublicKey.default)) throw new Error('counterparty must be a non-zero pubkey');` in `openChannel`.  
**Note:** On-chain fix (add `require!` in `open_channel_handler`) is tracked separately as a program-level finding. SDK-side guard prevents the user error reaching the chain.

---

### M-002 — PBS SDK: `expirySlot` Not Validated Client-Side
**File:** `sdk/src/ProbabilisticModule.ts`  
**Description:** `commitProbabilistic` validates `amount > 0` and `conditionHash.length === 32` but does NOT check that `expirySlot` is in the future. The on-chain program does enforce this (`require!(params.expiry_slot > clock.slot, SssError::InvalidExpirySlot)`) so funds cannot actually be locked with a past expiry, but the transaction will fail at the RPC level with an opaque program error rather than a clear SDK error. The docstring says "Must be > current slot" but there is no enforcement.

**Fix:** Caller should pass current slot; add a guard: `if (expirySlot.lten(0)) throw new Error('expirySlot must be a positive slot number');` plus a recommended pattern in JSDoc to fetch current slot first.

---

## LOW

### L-001 — `countersignSettle` Defaults Opener/Counterparty Token Accounts to Signer's ATA
**File:** `sdk/src/AgentPaymentChannelModule.ts` (lines ~`countersignSettle`)  
**Description:** When `openerTokenAccount` and `counterpartyTokenAccount` are not supplied, both default to the *signer's* ATA — meaning the opener's share and the counterparty's share would both go to the same account. This is wrong by design: the counterparty calling `countersignSettle` should default `counterpartyTokenAccount` to their own ATA and `openerTokenAccount` to the opener's ATA. Since the caller must always supply these to get correct behavior, the defaults are silently misleading.

**Fix:** Remove the misleading default or require both to be passed explicitly.

---

### L-002 — Backend: `mint` Endpoint Accepts Unverified `tx_signature`
**File:** `backend/src/routes/mint.rs`  
**Description:** The `tx_signature` field in a mint request is accepted and stored as-is with no on-chain verification. An authenticated client can record a mint event with a forged or random signature. Depending on how downstream systems consume this field, it could be used to spoof audit logs.

**Fix:** Either verify the signature exists on-chain before recording, or document clearly that `tx_signature` is informational/unverified. If used for compliance, it must be verified.

---

### L-003 — Rate Limiter is In-Memory and Resets on Restart
**File:** `backend/src/rate_limit.rs`  
**Description:** The token-bucket rate limiter is stored in a `Mutex<HashMap>` with no persistence. On process restart, all buckets reset to full, allowing a burst of `RATE_LIMIT_CAPACITY` (default 60) requests per key immediately after restart. An attacker who can trigger restarts (OOM, crash, deploy) can exploit the reset window.

**Fix:** Accept as a known limitation for single-instance deployments; document in `RATE_LIMIT_CAPACITY` env var description. For production, consider Redis-backed rate limiting.

---

## INFO

### I-001 — No Webhook HMAC Signature
**File:** `backend/src/webhook_dispatch.rs`  
**Description:** Webhook deliveries include no HMAC or secret-based signature. Subscribers cannot verify that a received webhook came from the SSS backend rather than a third party who knows the payload format.

**Recommendation:** Add an `X-SSS-Signature` header (HMAC-SHA256 of the payload body using a per-webhook secret) on delivery. Store the secret at webhook registration time.

---

### I-002 — PBS SDK Discriminators Are Hardcoded
**File:** `sdk/src/ProbabilisticModule.ts`, `AgentPaymentChannelModule.ts`  
**Description:** Anchor instruction discriminators are SHA-256("global:<fn>")[0..8]. These are hardcoded as raw byte arrays. If the instruction name is ever renamed, the discriminator silently becomes wrong. The IDL would catch this (once regenerated per H-001) but currently nothing validates them at build time.

**Recommendation:** Add a CI test that recomputes expected discriminators from instruction names and asserts they match the constants in the SDK files.

---

## Fixes Applied in This PR

- **H-001:** Regenerated IDL (see `sdk/src/idl/sss_token.json`)
- **H-002:** Added URL validation in `backend/src/routes/webhooks.rs` — rejects non-http(s), loopback, and RFC-1918 addresses
- **M-001:** Added zero-pubkey guard in `AgentPaymentChannelModule.openChannel`
- **M-002:** Added expirySlot > 0 guard in `ProbabilisticModule.commitProbabilistic` with JSDoc guidance

Remaining findings (L-001 through I-002) are documented above for follow-up in separate tasks.
