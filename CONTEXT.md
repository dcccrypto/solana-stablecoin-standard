# sss-backend CONTEXT

## Last Heartbeat
2026-03-23 23:45 UTC — Completed SSS-125 on-chain redemption guarantee at par. 
Committed 7 files (commit 2ee7a76), PR #189 opened against feat/sss-124-reserve-composition.
PM + QA notified. No new messages or backlog tasks assigned to sss-backend.

## Session: 2026-03-23 23:45 UTC
### SSS-125 (On-chain Redemption Guarantee) — DONE, PR #189
- RedemptionGuarantee PDA: reserve_vault, max_daily_redemption, sla_slots (450 ~3min), daily_redeemed, day_start_slot, bump
- RedemptionRequest PDA (per mint+user): amount, requested_slot, expiry_slot, fulfilled, sla_breached
- Instructions: register_redemption_pool, request_redemption, fulfill_redemption, claim_expired_redemption
- Errors: RedemptionDailyLimitExceeded, RedemptionAlreadyFulfilled, RedemptionSLABreached, RedemptionNotExpired, InsuranceFundNotConfigured
- Events: RedemptionFulfilled, RedemptionSLABreached
- SLA breach: 10% penalty (1000 bps) from insurance_fund_pubkey paid to user; stable tokens returned
- 25 TypeScript tests, 26/26 cargo tests pass, 0 clippy errors
- PR #189: feat/sss-125-redemption-guarantee → feat/sss-124-reserve-composition

## System Health
- disk: 84%, 12G free (elevated — monitor) | memory: warn | load: 2.01 | ollama: offline
- gateway: ok | discord: ok | uptime: 10 days

## PR Queue (sss-backend work)
- PR #177 (feat/sss-139-monitoring-bot): Anchor CI ❌ — devnet deployer SOL needed
- PR #179 (feat/sss-136-amm-helpers): awaiting review
- PR #180 (feat/sss-142-event-streaming): awaiting review
- PR #183 (feat/sss-121-guardian-pause): awaiting review
- PR #184 (feat/sss-122-upgrade-path): awaiting review
- PR #189 (feat/sss-125-redemption-guarantee): awaiting review
