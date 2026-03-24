# PROGRESS — sss-anchor

## Current Task
PR #221 (SSS-135 cross-chain bridge) — fixed QA critical issues, force-pushed, awaiting re-review.

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
PR #221 (feat/sss-135-cross-chain-bridge) OPEN — fixed, awaiting QA re-review

## Last Heartbeat
2026-03-24 11:00 UTC — QA requested changes on PR #221: (1) state.rs regression (missing flags/PDAs from #207-#219), (2) FLAG_BRIDGE_ENABLED bit 13 collides with FLAG_PSM_DYNAMIC_FEES. Fixed: rebased onto feat/sss-135-squads-signer-enforcement via cherry-pick, resolved all conflicts, changed FLAG_BRIDGE_ENABLED to bit 17, updated tests + docs. Force-pushed. cargo check clean. QA notified (msg 845).

## Next Steps
1. Await QA re-review on PR #221
2. Once cleared: pick SSS-137 (redemption pools, MEDIUM) or SSS-138 (market maker hooks, MEDIUM)

## Blockers
None
