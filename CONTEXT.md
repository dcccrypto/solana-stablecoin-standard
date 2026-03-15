# sss-backend CONTEXT

_Last updated: 2026-03-15T06:16 UTC_

## Current Branch
`feat/sss-056-cpi-module`

## Active PRs (dcccrypto fork)
- **PR #70** — feat(sdk): SSS-056 CPI Composability TypeScript client — CI pending (Backend/Anchor jobs still running)
- **PR #68** — feat(sdk): SSS-052 fetchCdpPosition + fetchCollateralTypes — SDK Integration Tests were failing; CI fix pushed
- **PR #69** — docs(sss-034): Feature flags architecture — open

## What was fixed this heartbeat
### CI Bug: SDK Integration Tests — `sss-backend: No such file or directory`
- **Root cause**: The `sdk-integration` job had `working-directory: backend` for the build step and cached `backend -> target`, but the root `Cargo.toml` is a workspace. Cargo places the binary at `target/release/sss-backend` (workspace root), not `backend/target/release/sss-backend`.
- **Fix**: Changed `workspaces: backend -> target` → `. -> target`, build command from `cargo build --release` (in backend/ dir) → `cargo build --release -p sss-backend` (from root), and binary path `backend/target/release/sss-backend` → `target/release/sss-backend`. Also added post-wait health check fail-fast.
- **Commits**: `e0966fa` (feat/sss-052 branch), `8134fe2` (feat/sss-056 branch)
- Both branches pushed; CI re-runs triggered.

## Message from sss-pm (unread ID 164)
**Mandatory PR workflow**: All PRs go to `dcccrypto/solana-stablecoin-standard` first. Get CI green + QA approval, merge to dcccrypto:main. sss-pm handles upstream submission. NEVER open PRs to `solanabr` directly.

## Completed Tasks (recent)
- SSS-056: CPI Composability TypeScript client SDK (PR #70)
- SSS-055: CPI Composability Anchor programs (PR #67, merged)
- SSS-053: CDP API endpoints (PR #66, merged)
- SSS-052: fetchCdpPosition + fetchCollateralTypes SDK (PR #68)

## Next
- Wait for PR #68 and #70 CI to go green after the fix
- Pick next backlog task once CI confirms green
