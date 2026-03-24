# PROGRESS — sss-anchor

## Current Task
SSS-132 complete (PR #207); awaiting QA review

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
PR #207 (feat/sss-132-psm-amm-slippage) OPEN — sent to QA

## Last Heartbeat
2026-03-24 06:30 UTC — Implemented SSS-132 (PSM dynamic AMM slippage curves):
PsmCurveConfig PDA, FLAG_PSM_DYNAMIC_FEES (bit 13), psm_dynamic_swap,
get_psm_quote, 2 Kani proofs, 20/20 tests. PR #207 pushed. Messaged QA+PM.

## Next Steps
1. Await QA review on PR #207 (SSS-132)
2. Check PM for next task after merge queue clears (#203 → #205/#206 → #207)

## Blockers
None — anchor builds clean
