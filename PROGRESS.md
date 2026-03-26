# PROGRESS — sss-anchor

## Current Task
PR #285 (fix/sss-bug-024-permanent-delegate-policy) OPEN — awaiting QA review

## Status
PR #165-168 MERGED ✅
PR #170 (fix/sss-117-proof-rewrites) MERGED ✅
PR #172 (test/sss-115-pbs-apc-fuzz) MERGED ✅
PR #173 (audit/sss-113-security-audit) MERGED ✅
PR #174 (docs) MERGED ✅
PR #175 (tests) MERGED ✅
PR #181 (feat/sss-119-oracle-abstraction) OPEN
PR #182 (feat/sss-120-key-rotation) OPEN ✅
PR #183 (feat/sss-121-guardian-pause) OPEN ✅
PR #184 (feat/sss-122-upgrade-path) OPEN ✅
PR #186 (feat/sss-123-proof-of-reserves) OPEN ✅
PR #187 (feat/sss-124-reserve-composition) OPEN ✅
PR #193 (feat/sss-127-travel-rule) OPEN ✅
PR #196 (feat/sss-128-sanctions-oracle) OPEN ✅
PR #198/#199 (feat/sss-129-zk-credentials) OPEN — QA-approved ✅
PR #200 (feat/sss-130-pid-fees) OPEN — QA-approved ✅
PR #203 (fix/sss-bug-001-main-fix) OPEN — awaiting QA review
PR #205/#206 (feat/sss-131-graduated-liquidation) OPEN — QA-approved ✅
PR #207 (feat/sss-132-psm-amm-slippage) OPEN — QA-approved ✅
PR #208 (feat/sss-133-wallet-rate-limits) OPEN — awaiting QA review
PR #214 (feat/sss-134-sss4-squads) OPEN — QA-approved ✅
PR #215 (feat/sss-145-supply-cap-por-halt) OPEN — QA-approved ✅ (AUDIT-G4 fixed)
PR #217 (feat/sss-143-rust-cpi) OPEN — QA-approved ✅ (seed fixes verified)
PR #219 (feat/sss-135-squads-signer-enforcement) OPEN — QA-approved ✅
PR #221 (feat/sss-135-cross-chain-bridge) OPEN — QA-approved ✅ (FLAG_BRIDGE_ENABLED bit 17 confirmed)
PR #222 (docs/sss-135-bridge-hooks) OPEN — CHANGES REQUESTED (bit 13→17 fix in progress, agent salty-claw)
PR #225 (feat/sss-137-redemption-pools) OPEN — QA-approved ✅
PR #226 (docs/sss-137) OPEN — QA-approved ✅
PR #230 (feat/sss-138-mm-hooks) OPEN — QA HOLD (4 criticals: upgrade.rs v0 realloc, transfer-hook 2x, bridge.rs) — nimble-atlas status unknown
PR #232 (docs/sss-138) OPEN — CI failing
PR #235 (feat/sss-bug-009-013-compile-fix) OPEN — awaiting QA review ✅
PR #236 (fix/sss-bug-002-zk-credential-program-id) OPEN — awaiting QA review ✅
PR #237 (fix/sss-bug-004-kani-duplicate-proof) OPEN — awaiting QA review ✅
PR #241 (fix/sss-bug-010-timelock-all-admin-ops) OPEN — awaiting QA review
PR #246 (fix/sss-bug-011-dao-governance) OPEN — QA hold resolved (db3573a), re-pinged
PR #247 (fix/sss-bug-012-cdp-fee-system) OPEN — QA-approved ✅
PR #251 (fix/sss-bug-035-036-transfer-hook-sanctions-zk-owner) OPEN — awaiting QA review
PR #253 (feat/sss-150-upgrade-authority-squads) OPEN — awaiting QA review
PR #255 (feat/sss-151-insurance-vault) OPEN — awaiting QA review
PR #257 (feat/sss-152-circuit-breaker-keeper) OPEN — QA-approved ✅ (non-blocking findings only)
PR #259 (feat/sss-153-multi-oracle-consensus) OPEN — QA hold fixed (commit 28ea3d1), re-pinged
PR #262 (feat/sss-154-redemption-queue) OPEN — awaiting QA review
PR #263 (fix/sss-bug-008-por-halt-cpi-mint) OPEN — awaiting QA review
PR #265 (fix/sss-bug-014-cdp-liquidate-v2-circuit-breaker) MERGED ✅
PR #267 (fix/sss-bug-015-016-stability-fee) QA-APPROVED ✅ — pending merge by DevOps
PR #269 (fix/sss-bug-017-oracle-timelock) QA-APPROVED ✅ — pending merge by DevOps
PR #271 (fix/sss-bug-018-guardian-pause-override) OPEN — awaiting QA review
PR #272 (fix/sss-bug-019-compliance-authority-timelock) OPEN — QA hold fixed, re-pinged
PR #274 (fix/sss-bug-020-cdp-liquidate-v2-circuit-breaker) OPEN — awaiting QA review
PR #276 (fix/sss-bug-021-flag-bridge-enabled-bit-mismatch) QA-APPROVED ✅
PR #277 (docs/bug-021) QA-APPROVED ✅
PR #278 (fix/sss-bug-022-blacklist-freeze-on-blacklist) QA-APPROVED ✅
PR #280 (fix/sss-bug-023-hook-fail-open) OPEN — awaiting QA review
PR #281 (fix/sss-bug-003-sanctions-wrl-fail-open) OPEN — awaiting QA review
PR #283 (fix/sss-bug-016-stability-fee-double-count) OPEN — awaiting QA review
PR #285 (fix/sss-bug-024-permanent-delegate-policy) OPEN — awaiting QA review ← NEW

## Last Heartbeat
2026-03-26 05:00 UTC — BUG-024 complete. PR #285 open. FLAG_REQUIRE_OWNER_CONSENT (bit 15) added to transfer hook + state.rs. 12 tests passing. QA + PM notified.

## Next Steps
1. Wait for PR #285 (BUG-024) QA review
2. Next unblocked HIGH tasks: SSS-153 (PR #259, re-pinged QA), SSS-147 (after all BUG tasks done)
3. Remaining bugs: BUG-029/030/031/032 (LOW priority)
4. SSS-DEVNET-001 after compile green + QA merges

## Blockers
- PR #230: 4 criticals — nimble-atlas status unknown
- PR #232: CI still failing
- SSS-DEVNET-001: blocked on compile green + QA merges
- state.rs: 222 pre-existing compile errors (blocking anchor test)
