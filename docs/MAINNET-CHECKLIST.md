# SSS Mainnet Readiness Checklist

**Audit Date:** 2026-03-15  
**Auditor:** sss-anchor agent  
**Task:** SSS-030 — Mainnet readiness audit: program security + upgrade authority  
**Branch:** `audit/sss-030-mainnet-readiness`  
**Programs audited:**
- `sss_token` — `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`
- `sss_transfer_hook` — `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

---

## 1. Upgrade Authority ✅ / ⚠️

| Item | Status | Notes |
|------|--------|-------|
| Upgrade authority is not frozen (programs are upgradeable) | ⚠️ **ACTION REQUIRED** | For mainnet, upgrade authority should be transferred to a multisig (e.g. Squads) or the program should be frozen (immutable). Currently uses deployer keypair by default. |
| Recommendation | — | Transfer upgrade authority to a 3-of-5 Squads multisig before mainnet. If a frozen/immutable deployment is desired, run `solana program set-upgrade-authority --final <PROGRAM_ID>`. |

**Steps to transfer to multisig:**
```bash
# Create multisig via Squads v4 UI or CLI, then:
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <MULTISIG_PUBKEY> \
  --keypair ~/.config/solana/id.json
```

---

## 2. Hardcoded Devnet / Localnet Addresses ✅

| Item | Status | Notes |
|------|--------|-------|
| `Anchor.toml` `[programs.devnet]` section | ⚠️ **ACTION REQUIRED** | No `[programs.mainnet]` section — must be added before deploying to mainnet. Program IDs may differ from devnet after mainnet deploy. |
| `[provider]` cluster | ⚠️ **ACTION REQUIRED** | Currently set to `"Localnet"`. Must be updated to `"Mainnet"` for mainnet deployment. |
| Hardcoded addresses in Rust source | ✅ **PASS** | No hardcoded devnet/localhost addresses found in `programs/` Rust source. |
| `declare_id!` macro (both programs) | ⚠️ **VERIFY** | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` and `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` are devnet deploy addresses. After mainnet deploy these will differ; `declare_id!` must be updated and program re-built. |

**Required `Anchor.toml` update:**
```toml
[programs.mainnet]
sss_token = "<MAINNET_PROGRAM_ID>"
sss_transfer_hook = "<MAINNET_TRANSFER_HOOK_ID>"

[provider]
cluster = "Mainnet"
```

---

## 3. Admin / Governance Access Control ✅

| Item | Status | Notes |
|------|--------|-------|
| `initialize` sets `authority = payer` | ✅ **PASS** | Deployer becomes authority; can be transferred to multisig via `update_roles`. |
| `update_roles` (authority transfer) | ✅ **PASS** | Two-step pattern: `update_roles` proposes, `accept_authority` confirms. No single-sig takeover possible. |
| Compliance authority transfer | ✅ **PASS** | Same two-step pattern via `accept_compliance_authority`. |
| Minter registration | ✅ **PASS** | Gated by `authority` signer check in `update_minter` / `revoke_minter`. |
| Pause / Unpause | ✅ **PASS** | Gated by `authority`. |
| Freeze / Thaw | ✅ **PASS** | Gated by `compliance_authority`. |
| Reserve vault / collateral mint set at init | ✅ **PASS** | Immutable post-init — no setter instruction; prevents vault swapping attacks. |
| Blacklist management (transfer hook) | ✅ **PASS** | Gated by `blacklist_state.authority`. Initialized to `authority` at hook init time. |
| PDA seeds validated | ✅ **PASS** | All accounts use `seeds = [SEED, mint.key()]` with `bump` stored/verified. |

**⚠️ Recommendation:** Before mainnet, call `update_roles` to transfer authority to a multisig wallet. The deployer keypair should **not** remain as sole authority on mainnet.

---

## 4. TODO / FIXME Scan ✅

Scanned all files in `programs/` with:
```
grep -rn "TODO|FIXME|HACK|devnet|localhost|127.0.0.1" programs/ --include="*.rs"
```

**Result:** No `TODO`, `FIXME`, or `HACK` comments found in program source. No hardcoded devnet/localhost strings in Rust. ✅

---

## 5. Program Buffer Size ⚠️

| Item | Status | Notes |
|------|--------|-------|
| `sss_token` buffer size verified | ⚠️ **ACTION REQUIRED** | Buffer must be sized for the actual compiled `.so`. Run `anchor build` on mainnet config; check with `solana program show <PROGRAM_ID>`. Allocate at least 2× current binary size to allow future upgrades. |
| `sss_transfer_hook` buffer size | ⚠️ **ACTION REQUIRED** | Same as above. |

**Verify with:**
```bash
anchor build
ls -lh target/deploy/*.so
# Then deploy with enough lamports:
solana program deploy --buffer-size <BYTES> target/deploy/sss_token.so
```

---

## 6. Security Observations

### 6a. BlacklistState — Unbounded Vec (Medium Risk ⚠️)

**File:** `programs/transfer-hook/src/lib.rs`  
**Issue:** `BlacklistState.blacklisted` is a `Vec<Pubkey>` with `INIT_SPACE` sized for 100 entries. If more than 100 addresses are blacklisted, the account will not have enough allocated space and `blacklist_add` will panic/error on realloc.  
**Recommendation:** Either cap at 100 with an explicit error, use a `realloc` constraint in the `ManageBlacklist` context, or migrate to a per-address PDA bitmap for unbounded scaling.

### 6b. `total_collateral` Desync Risk (Low Risk ⚠️)

**File:** `programs/sss-token/src/instructions/deposit_collateral.rs`  
**Issue:** `config.total_collateral` is incremented in the `deposit_collateral` handler but does not cross-check the actual vault balance via a CPI read. If collateral is withdrawn from the vault externally (not via the redeem instruction), the on-chain accounting will diverge from actual vault holdings.  
**Recommendation:** For mainnet, the reserve vault authority should be the config PDA (no external withdrawal possible) and this should be enforced in the `Initialize` handler. Document clearly that reserve vault withdrawals only go through `redeem`.

### 6c. Mint Authority is Config PDA (Positive ✅)

The Token-2022 mint authority and freeze authority are set to the config PDA (not the deployer keypair) at initialization time. This means only the program logic (via CPI with PDA signer seeds) can mint or freeze — the deployer key cannot directly mint tokens on mainnet. This is a strong security property.

### 6d. No Reentrancy Risk ✅

Anchor handles reentrancy via borrow-checking on account references. No obvious reentrancy vectors found.

---

## 7. Pre-Mainnet Checklist (Action Items)

- [ ] **Transfer program upgrade authority** to a 3-of-5 Squads multisig (or freeze if immutable deployment is desired)
- [ ] **Transfer `authority` and `compliance_authority`** for all deployed stablecoin configs to the multisig via `update_roles` + `accept_authority`
- [ ] **Add `[programs.mainnet]` section** to `Anchor.toml` with post-deploy mainnet program IDs
- [ ] **Update `declare_id!`** in both programs to the mainnet-deployed addresses and rebuild
- [ ] **Verify program buffer sizes** are sufficient for deployed `.so` binaries
- [ ] **Blacklist cap fix**: cap `blacklist_add` at 100 entries with an explicit error, or implement realloc/PDA-per-address approach before production use of SSS-2
- [ ] **Audit reserve vault ownership**: ensure reserve vault's token account authority is the config PDA for SSS-3 deployments
- [ ] **Run `anchor test` on mainnet-simulated cluster** after address updates
- [ ] **Perform a security audit** by an independent third party (e.g. OtterSec, Sec3, Neodyme) before significant TVL

---

## Summary

| Category | Status |
|----------|--------|
| Upgrade authority | ⚠️ Needs multisig before mainnet |
| Devnet addresses in source | ⚠️ `Anchor.toml` cluster + `[programs.mainnet]` section needed |
| Access control | ✅ Solid two-step authority pattern |
| TODO/FIXME scan | ✅ None found |
| Program buffer size | ⚠️ Verify after mainnet build |
| Blacklist scalability | ⚠️ 100-address hard cap needs fix |
| Collateral accounting | ⚠️ Low risk; document vault ownership constraint |
| Overall | ⚠️ **NOT YET MAINNET READY** — action items above must be resolved |
