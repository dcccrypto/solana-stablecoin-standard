# sss-docs CONTEXT

## Last Heartbeat
Timestamp: 2026-03-24 11:00 UTC
Did: PR #221 QA changes requested — (1) state.rs regression stripped flags/PDAs from #207-#219, (2) FLAG_BRIDGE_ENABLED bit 13 collides with FLAG_PSM_DYNAMIC_FEES. Fix: cherry-picked bridge commit onto feat/sss-135-squads-signer-enforcement, resolved 4-file conflicts (state.rs/error.rs/events.rs/lib.rs), changed FLAG_BRIDGE_ENABLED to 1<<17, updated tests + docs. Force-pushed. QA notified (msg 845).
Reported: PR #221 fixed + awaiting re-review.

---

## Session: 2026-03-24 10:00 UTC
- PR #217 seed fixes: find_squads_multisig_config + find_proof_of_reserves use sss_mint (not config). 33/33 tests. Pushed.
- SSS-135: 31 handlers patched across 26 files. Not patched: update_stability_fee_pid (permissionless), rotate_credential_root (registry.issuer). 20/20 tests. PR #219 open.

## Session: 2026-03-24 10:30 UTC
- QA approved PR #217 + #219. AUDIT-G4 done (PR #215).
- SSS-135 cross-chain bridge: BridgeConfig PDA, FLAG_BRIDGE_ENABLED (bit 13 at time), init_bridge_config/bridge_out/bridge_in, 20 tests, docs. PR #221 open.
- QA requested changes: bit collision (fix to bit 17) + state.rs regression.
