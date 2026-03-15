# SSS Feature Flags Architecture Research

**Task:** SSS-034  
**Author:** sss-docs  
**Date:** 2026-03-15  
**Status:** Research complete — no code changes

> Khubair wants five new features (programmable spend policies, yield-bearing collateral, ZK compliance proofs, circuit breaker, DAO compliance committee) to be opt-in only. Builders pay for what they enable; zero bloat for those who do not. This document researches all viable feature-flag patterns, documents every real Solana constraint, evaluates each proposed feature against those constraints, and recommends a concrete architecture.

---

## Part 1 — Feature Flag Patterns on Solana

### Pattern 1: Preset u8 Field (Current Approach)

**How it works today:** `StablecoinConfig.preset: u8` encodes the tier — `1` = SSS-1, `2` = SSS-2, `3` = SSS-3. Each preset is a curated, fixed bundle of features. Instructions check `config.preset` and branch.

**Limits:**
- A `u8` can represent 256 presets — more than enough for simple tiers.
- The real limit is conceptual: presets are bundles, not individual toggles. Adding 5 new optional features creates `2^5 = 32` combinations — you'd need 32 new preset values or a spaghetti decision tree. 8+ presets remain manageable only if features are exclusive, not combinatorial.
- **Account size:** No change — `preset: u8` is already there.
- **Compute:** Negligible — one `u8` comparison per gate.
- **Upgrade path:** Add new preset values in a program upgrade. Backward compatible if existing values are never changed.
- **Composability:** Poor. CPIing programs don't know what preset the mint is, and they can't selectively enable/disable features per-caller.

**Verdict:** Good for ≤4 named tiers. Breaks down with combinatorial optional features. SSS-4 can't be "SSS-2 + circuit breaker + DAO multisig but no spend policies."

---

### Pattern 2: Bitmask Flags Field (u64)

**How it works:** Replace or supplement `preset: u8` with `feature_flags: u64`. Each bit position represents one feature. Instructions check specific bits: `config.feature_flags & FLAG_CIRCUIT_BREAKER != 0`.

```rust
pub const FLAG_TRANSFER_HOOK:         u64 = 1 << 0;  // bit 0
pub const FLAG_BLACKLIST:             u64 = 1 << 1;  // bit 1
pub const FLAG_COLLATERAL_VAULT:      u64 = 1 << 2;  // bit 2
pub const FLAG_SPEND_POLICIES:        u64 = 1 << 3;  // bit 3
pub const FLAG_YIELD_COLLATERAL:      u64 = 1 << 4;  // bit 4
pub const FLAG_ZK_COMPLIANCE:         u64 = 1 << 5;  // bit 5
pub const FLAG_CIRCUIT_BREAKER:       u64 = 1 << 6;  // bit 6
pub const FLAG_DAO_COMMITTEE:         u64 = 1 << 7;  // bit 7
// 56 bits remain for future features
```

**Account size impact:** Adding `feature_flags: u64` to `StablecoinConfig` costs **8 bytes** beyond the existing `preset: u8`. Current `StablecoinConfig` with `#[derive(InitSpace)]` is approximately:
- 32 (mint) + 32 (authority) + 32 (compliance_authority) + 1 (preset) + 1 (paused) + 8 (total_minted) + 8 (total_burned) + 32 (transfer_hook_program) + 32 (collateral_mint) + 32 (reserve_vault) + 8 (total_collateral) + 8 (max_supply) + 32 (pending_authority) + 32 (pending_compliance_authority) + 1 (bump) = **293 bytes** + 8 byte discriminator = **301 bytes**
- Adding `feature_flags: u64` → **309 bytes** — trivial. Rent is ~0.002 SOL for 300 bytes; 9 extra bytes costs <0.0001 SOL additional.

**Compute unit cost:** A bitwise AND is ~1 CU. Zero meaningful overhead.

**Upgrade path:** Add the field in a program upgrade. Existing accounts have `feature_flags = 0` (all off) by default — fully backward compatible. Set flags at `initialize` time. Post-init flag changes could be allowed via a new `update_features` instruction (authority-only).

**Composability:** Excellent. Any CPI caller can read `config.feature_flags` from the deserialized PDA to know which features are active. No custom discriminator needed.

**Limitations:**
- All feature flags live in one account — no per-feature isolation. If a feature needs its own PDA state (e.g., spend policy rules), the flags field alone is insufficient. The flag says "this feature is enabled"; the feature's state lives in a dedicated PDA.
- Feature flag values must be stable across program versions (bit positions can never change meaning).

**Verdict:** **Best choice for the flags field itself.** Minimal cost, maximum flexibility, 56 bits of headroom. Combine with feature-specific PDAs for state.

---

### Pattern 3: Separate Extension PDAs (Token-2022 Model)

**How it works:** Each feature is a distinct PDA that only exists if the feature is enabled. The program checks for PDA existence using `AccountInfo` deserialization or by requiring the account as `Option<Account<...>>` in the Anchor context.

Example: `SpendPolicyConfig` PDA with seeds `["spend-policy", mint]` — exists only for mints that opted into spend policies at init.

**Account size impact per feature:**
- `SpendPolicyConfig`: ~200 bytes → ~0.002 SOL rent (2,039,280 lamports per byte × 200 ≈ 0.0014 SOL at current exemption threshold)
- `YieldVaultConfig`: ~128 bytes → ~0.001 SOL
- `CircuitBreakerConfig`: ~96 bytes → ~0.0008 SOL
- `DaoCommitteeConfig`: ~128 bytes → ~0.001 SOL
- `ZkComplianceConfig`: ~64 bytes → ~0.0005 SOL
- **Total if all 5 enabled:** ~616 bytes of additional accounts, ~0.005 SOL extra rent

**Compute unit cost:**
- Each PDA account passed as `Option<Account<...>>` costs ~2,000–3,000 CU to deserialize.
- For a mint that doesn't have a feature: if the account is not passed, the `Option` is `None` — no deserialization cost.
- For a mint that has the feature: PDA passed, deserialized, ~2,000–3,000 CU per feature.

**Lookup overhead:** Clients must derive and pass the correct PDA for each enabled feature. This increases accounts per transaction (see Part 2 — max 64 accounts per tx).

**Upgrade path:** New features add new PDA types. Existing accounts are unaffected. The most additive upgrade path of all patterns.

**Composability:** Excellent — each feature PDA is independently verifiable. CPIing programs can check a specific feature PDA without needing to understand the whole StablecoinConfig.

**Limitations:**
- More accounts per transaction. A fully-featured SSS token with all 5 features might need 5 additional PDAs passed in, consuming scarce account slots.
- Initialization is more complex — builders must call `initialize_feature_x` instructions separately (or extend the main `initialize` with optional feature inits).

**Verdict:** Best for features with significant state (spend policy rules, DAO committee membership). Combine with the bitmask — the flag says "enabled", the PDA holds the config.

---

### Pattern 4: Separate Programs (Anchor + CPI)

**How it works:** Each feature is a separate Anchor program. The main `sss-token` program calls it via CPI. E.g., `sss-spend-policy`, `sss-circuit-breaker`, `sss-dao-committee`.

**Account size impact:** Minimal — the main `StablecoinConfig` just stores the program IDs.

**Compute unit cost:** CPI overhead is ~1,000–2,000 CU per call. Plus the called program's own compute. A transfer that triggers 3 CPIs costs ~6,000 CU in overhead alone.

**CPI depth:** This is the critical constraint (see Part 2). Solana caps CPI depth at **4 levels**. Current SSS-2 transfer flow:
```
User → Token-2022 → sss-transfer-hook → (potential SSS CPI)
```
That's already 2–3 levels deep depending on implementation. Adding another program call from within the hook risks hitting the cap. Any feature that needs to CPI from inside the transfer hook must be counted against this limit extremely carefully.

**Upgrade path:** Each program can be upgraded independently. Good isolation.

**Composability:** The weakest — callers must know which feature programs are deployed and their program IDs.

**Limitations:**
- CPI depth is the hard wall. If `sss-spend-policy` itself needs to CPI (e.g., to Token-2022 or Pyth), depth = 4 is consumed by: `Token-2022 → transfer-hook → sss-spend-policy → external`. Zero headroom.
- Program deployment costs (each program needs its own buffer account, deployment transaction).
- Maintaining multiple on-chain program IDs adds operational complexity.

**Verdict:** Use only for features that are clearly isolated, not composed through the transfer hook chain. **DAO committee** and **yield collateral** are candidates — they're invoked via dedicated instructions, not inside token transfers. Avoid for features that must be evaluated during every transfer.

---

### Pattern 5: Config Account with Vec<Extension>

**How it works:** `StablecoinConfig` contains a `Vec<u8>` or `Vec<ExtensionData>` encoding enabled features dynamically. Similar to how Token-2022 extension data is appended to the mint account.

```rust
pub struct StablecoinConfig {
    // ... existing fields ...
    pub extension_data: Vec<u8>,  // TLV-encoded feature configs
}
```

**Account size impact:** `Vec<u8>` in Anchor requires `realloc` support. The account must be initialized large enough for future extensions, or `realloc` must be called each time a new feature is added. `realloc` has practical limits: each `realloc` call can increase account size by at most **10KB per transaction**, and reallocating a large account can fail if memory is fragmented.

**Compute unit cost:** Parsing TLV data costs ~5,000–10,000 CU per feature lookup (linear scan through the vec). For a vec with 5 features, total parse cost ~25,000–50,000 CU on every instruction that checks features.

**Upgrade path:** Extensions can be appended without a program upgrade. Very flexible.

**Composability:** Very poor — callers must implement the TLV parsing scheme to read extension data.

**Limitations:**
- `realloc` complexity. If the account runs out of space, the transaction fails with `AccountDataTooSmall`. Requires pre-allocating max size (wasted rent) or a multi-transaction `realloc` dance.
- Linear-scan parsing is expensive in CU terms.
- No Anchor type safety — raw `Vec<u8>` loses the compile-time guarantees that make Anchor safe.

**Verdict:** Avoid. The complexity/risk tradeoff is unfavorable. Bitmask + separate PDAs achieves the same flexibility with far less complexity and better CU performance.

---

### Pattern Summary

| Pattern | Account Overhead | CU Overhead | Upgrade Path | Composability | Best For |
|---------|-----------------|-------------|--------------|---------------|---------|
| Preset u8 | None | ~1 CU | New preset values | Poor | Named tiers only |
| **Bitmask u64** | **8 bytes** | **~1 CU** | **Additive** | **Excellent** | **Feature on/off gates** |
| Extension PDAs | ~100–200B per feature | ~2–3K CU per PDA | Additive | Excellent | Feature-specific state |
| Separate programs | 32B per program ID | ~2K CU per CPI | Independent | Weak | Isolated features |
| Vec<Extension> | Variable | ~5–10K CU/feature | Additive | Very poor | Avoid |

**Recommended:** **Bitmask u64 + extension PDAs**. The flags field gates feature access at near-zero cost; extension PDAs hold per-feature state that only exists when the feature is enabled.

---

## Part 2 — Solana Hard Limits

### Max Account Size: 10 MB

The absolute maximum is **10,485,760 bytes** per account. The practical limit for a **single-transaction realloc** is much more restrictive:
- `SystemProgram::allocate` (at account creation) can set any size up to 10MB.
- `realloc` (resize after creation) is capped at **10,240 bytes** added **per instruction**.
- A blacklist with 50,000 entries stored in one account would need ~1.6MB — possible at creation but not via incremental realloc.
- **For SSS:** All feature PDAs are small (≤256 bytes). The blacklist is the large account risk — it should use per-address PDAs (existence-check pattern) rather than a single vec-based account.

### Max CPI Depth: 4 Levels

This is the **hardest constraint** for feature composition. The rule: each CPI counts as one level. The call stack depth at any point must not exceed 4.

Current SSS-2 transfer call stack:
```
Level 1: User wallet calls Token-2022 (transfer instruction)
Level 2: Token-2022 CPIs → sss-transfer-hook (transfer_hook instruction)
Level 3: sss-transfer-hook checks BlacklistState (no CPI needed — read-only account)
```
At level 3 we have one level of headroom. If the transfer hook itself needs to CPI (e.g., to update a velocity tracker PDA via a separate compliance program), that consumes the final slot:
```
Level 4: sss-transfer-hook → compliance-program (update_velocity)
```
Any additional CPI from level 4 would fail with `CallDepth`. This means:
- **Spend policies evaluated during transfer:** Must be in the same program as the transfer hook, not a separate CPI.
- **ZK proof verification during transfer:** Must be a pre-verified proof (submitted in a prior instruction), not a CPI to a ZK verifier.
- **Circuit breaker check during transfer:** Must be a read-only account check, not a CPI.

**Features that invoke separate instructions (not via transfer hook) have no CPI depth problem.** DAO committee actions, yield collateral deposits/withdrawals, and circuit breaker triggers that are their own instructions are all at depth 1 from the user.

### Max Compute Units per Transaction: 1,400,000 CU

The base compute budget is **200,000 CU per instruction**. Builders can request up to **1,400,000 CU** via `ComputeBudgetInstruction::set_compute_unit_limit`. This is the hard wall for a single transaction.

Estimated CU cost breakdown for a fully-featured SSS-4 transfer (all features enabled):
| Operation | CU cost |
|-----------|---------|
| Token-2022 transfer instruction | ~15,000 |
| CPI to transfer hook program | ~2,000 overhead |
| Blacklist check (PDA deserialization) | ~3,000 |
| Spend policy rule evaluation (5 rules) | ~25,000 |
| Circuit breaker account read | ~2,000 |
| ZK compliance proof verification (pre-verified path) | ~5,000 |
| Total (approximate) | **~52,000 CU** |

This is well within the 1,400,000 CU ceiling. Even with verbose logging and conservative estimates, a fully-featured transfer should stay under **150,000 CU** — comfortable. The ZK proof verification cost (1,700,000 CU for generating a full ZK proof) only applies if verification happens in the same instruction; **pre-verification in a prior instruction** eliminates this problem.

### Max Accounts per Transaction: 64

Each transaction can reference at most **64 unique accounts**. A fully-featured SSS-4 transfer with all 5 features enabled requires:

| Account | Count |
|---------|-------|
| User wallet (signer) | 1 |
| Source token account | 1 |
| Destination token account | 1 |
| Token-2022 mint | 1 |
| Token-2022 program | 1 |
| sss-transfer-hook program | 1 |
| ExtraAccountMetaList PDA | 1 |
| BlacklistState PDA (sender) | 1 |
| BlacklistState PDA (receiver) | 1 |
| SpendPolicyConfig PDA | 1 |
| VelocityTracker PDA (sender) | 1 |
| CircuitBreakerState PDA | 1 |
| ZkComplianceConfig PDA | 1 |
| System program | 1 |
| Compute budget program | 1 |
| **Total** | **15** |

15 accounts for a fully-featured transfer — well within the 64-account limit. Even with yield-collateral state and DAO committee config added, we'd stay under 25 accounts. The 64-account limit is not a binding constraint for SSS.

### Transaction Size Limit: 1,232 Bytes

A Solana transaction is limited to **1,232 bytes** on the wire (maximum UDP packet size). This includes:
- Signatures (64 bytes each, typically 1–3 signatures)
- Account keys (32 bytes each)
- Recent blockhash (32 bytes)
- Instructions (instruction data + account indices)

A transfer with 15 accounts and typical instruction data:
- 15 accounts × 32 bytes = 480 bytes
- 1 signature × 64 bytes = 64 bytes
- 1 blockhash × 32 bytes = 32 bytes
- Instruction overhead (~10 bytes per instruction)
- Instruction data (discriminator 8 bytes + amount 8 bytes = 16 bytes)
- **Approximate total: ~620 bytes**

This leaves ~612 bytes of headroom. An SSS-4 transaction with compute budget instruction and all feature accounts fits comfortably. For more complex initialization transactions (which pass many optional parameters), the limit is tighter — but initialization is a one-time operation and can be split into multiple transactions if needed.

**The 1,232-byte limit becomes a concern only with Address Lookup Tables (ALTs).** If a fully-featured SSS-4 token needs >30 unique accounts in a single transaction, ALTs can be used to compress the account list — an ALT reference costs only 1 byte per account vs 32 bytes.

### Rent Costs: Per-Feature PDA Overhead

Solana charges rent-exemption deposits for every persistent account. The exemption threshold is currently ~**6,960 lamports per byte** (0.00000696 SOL/byte), requiring `128 + data_size` bytes to be rent-exempt.

| Feature PDA | Estimated Size | Rent-Exempt Cost |
|-------------|---------------|-----------------|
| SpendPolicyConfig | 192 bytes | ~0.0021 SOL |
| YieldCollateralConfig | 128 bytes | ~0.0014 SOL |
| ZkComplianceConfig | 96 bytes | ~0.0010 SOL |
| CircuitBreakerState | 128 bytes | ~0.0014 SOL |
| DaoCommitteeConfig | 256 bytes | ~0.0027 SOL |
| **All 5 features** | **800 bytes total** | **~0.0086 SOL** |

At ~$140/SOL, enabling all 5 features costs the builder approximately **$1.20 in additional rent**. This is noise — not a meaningful cost driver. The bitmask approach makes this cost opt-in: builders who don't enable a feature pay nothing for it.

---

## Part 3 — What Is Actually Possible?

### Feature 1: Programmable Spend Policies (Rule Engine in Transfer Hook)

**Concept:** On-chain rules encoding velocity limits, amount thresholds, sender/receiver restrictions. Evaluated during every token transfer via the transfer hook.

**Feasibility:** ✅ **Fully feasible within Solana limits.**

The TECH-SPIKE-DIRECTIONS.md (Direction 4) already proves this with 82 passing spike tests. Key findings:
- A 10-rule ruleset costs ~35,000 CU inside the transfer hook — comfortable within the 400,000 CU the hook can use.
- Rule PDAs (`SpendPolicyConfig`, `Rule`, `VelocityTracker`) are small (64–128 bytes each).
- **CPI depth:** If the rule evaluation stays within `sss-transfer-hook` (same program), CPI depth is not consumed. If rules are in a separate `sss-spend-policy` program, depth = 4 is hit (Token-2022 → transfer-hook → spend-policy → [blocked]). **Solution: implement rule evaluation within the transfer hook program, not as a separate program CPI.**
- **Velocity tracker limitation:** Solana slots ≠ wall-clock seconds. Rolling windows are slot-based (approximate). A 1-hour velocity window at ~2.5 slots/second ≈ 9,000 slots. Acceptable for compliance but not precise to the second.

**Minimal viable implementation:**
- `SpendPolicyConfig` PDA: `["spend-policy", mint]` — stores rule count, max amounts
- `Rule` PDA: `["rule", spend_policy, rule_id]` — per-rule params (type, threshold, window)
- `VelocityTracker` PDA: `["velocity", mint, wallet, window_start_slot]` — rolling window state
- Transfer hook reads `SpendPolicyConfig`, iterates passed `Rule` accounts, short-circuits on first failure

**What breaks if done wrong:** Including `VelocityTracker` as a writable PDA in the transfer hook makes the hook's account list dynamic per-sender. Token-2022's ExtraAccountMetaList is static — dynamic accounts must be passed via the `remaining_accounts` pattern. This is supported but adds client-side complexity.

---

### Feature 2: Yield-Bearing Collateral (Solend/MarginFi CPI from SSS-3 Vault)

**Concept:** Instead of the SSS-3 reserve vault sitting idle, deposit it into a lending protocol (Solend, MarginFi, Kamino) to earn yield. The yield accrues to the vault, increasing the effective collateral ratio over time.

**Feasibility:** ⚠️ **Feasible but with CPI depth constraints.**

- **CPI depth for deposit:** User calls `sss-token::deposit_to_yield_vault` (level 1) → SSS CPIs to Solend/MarginFi (level 2) → Solend CPIs to Token-2022 for the SPL transfer (level 3). That's 3 levels — safe.
- **CPI depth during mint:** If the mint instruction reads yield vault balance (to compute collateral), that's a read-only account lookup — no CPI needed. Safe.
- **CPI depth for withdrawal:** `sss-token::redeem` (level 1) → SSS CPIs to yield protocol to withdraw (level 2) → yield protocol CPIs to Token-2022 (level 3). Safe.
- **Yield protocol risk:** MarginFi/Solend are external programs. If they're upgradeable, a malicious upgrade could steal vault assets. Mitigation: use only battle-tested protocols, prefer Kamino (audited, immutable vaults), and consider only depositing a percentage of reserves.
- **Oracle dependency:** Yield protocols report balances in receipt tokens (e.g., mSOL, LP tokens), not raw USDC. The SSS mint instruction must convert receipt token balance → underlying USDC equivalent, which requires either an oracle (reintroducing oracle risk) or the yield protocol's own CPI to read the exchange rate.

**Minimal viable implementation:**
- `YieldVaultConfig` PDA: `["yield-vault", mint]` — stores yield protocol program ID, receipt token mint, deposit percentage cap
- New instructions: `deposit_to_yield_vault(amount)`, `harvest_yield()`, `withdraw_from_yield_vault(amount)`
- The SSS-3 `mint` instruction continues to read `total_collateral` from `VaultState` — the `harvest_yield` instruction updates `total_collateral` as yield accrues

**What breaks:** The collateral-backing guarantee is only as strong as the yield protocol. This feature intentionally introduces counterparty risk. Must be documented prominently and made opt-in with a clear warning.

---

### Feature 3: ZK Compliance Proofs (Private Blacklist, ZK Verification On-Chain)

**Concept:** Instead of a public on-chain blacklist (where everyone can see who is blacklisted), use a ZK Merkle-proof scheme: the compliance authority publishes a Merkle root of all blacklisted addresses. Wallets that are NOT blacklisted generate a ZK non-membership proof to prove they're cleared, without revealing who else is on the list.

**Feasibility:** ⚠️ **Feasible but requires pre-verification pattern. Full ZK verification in a transfer instruction will exceed compute limits.**

Critical constraint from Part 2:
- ZK proof verification (`VerifyTransferWithFee`, range proofs): **~1,700,000 CU** — over the 1,400,000 CU hard limit.
- **Solution: Solana's proof-splitting pattern.** Clients submit a `VerifyProof` pre-instruction in the same transaction (separate instruction slot). This instruction pre-verifies the proof and stores a verification result in a temporary PDA. The transfer instruction then reads this PDA — cheap (~2,000 CU). The total transaction budget is 1,400,000 CU which must cover both instructions combined.

Updated CU analysis for ZK compliance pre-verification:
- `VerifyProof` instruction: ~500,000 CU (non-membership proof for a tree of depth 20)
- Transfer with all other features: ~52,000 CU (from Part 2)
- **Total: ~552,000 CU** — within the 1,400,000 CU limit. ✅

**CPI depth:** ZK proof pre-verification is a separate instruction in the same transaction, not a CPI. No depth consumed.

**Minimal viable implementation:**
- `ZkBlacklistRoot` PDA: `["zk-blacklist", mint]` — stores current Merkle root + epoch
- `ProofVerification` ephemeral PDA: `["zk-proof-verify", wallet, tx_hash]` — written by `verify_non_membership_proof`, read by transfer hook, closed after use
- Compliance authority updates `ZkBlacklistRoot` off-chain via a private Merkle tree
- Client SDK generates Groth16 non-membership proof client-side (WASM), submits `verify_proof` + `transfer` in one transaction

**What breaks:** This is the most complex feature by far. The off-chain Merkle tree must be maintained by the compliance authority and kept private. If the tree becomes available publicly (e.g., via an IPFS leak), the privacy guarantee breaks. Proof generation requires a trusted setup for Groth16 or a transparent setup for STARKs.

**Simpler alternative:** Use the existing public blacklist (SSS-2 style) but add a `ZkComplianceConfig` PDA that enables *amount privacy* for transfers (Token-2022 Confidential Transfers). This is lower-complexity and achieves meaningful privacy without the ZK non-membership proof infrastructure.

---

### Feature 4: Circuit Breaker (Pyth Oracle Auto-Pause)

**Concept:** If a Pyth price feed shows the stablecoin has lost its peg (e.g., trading at <$0.95 or >$1.05), the system automatically pauses minting. A governance action is required to unpause.

**Feasibility:** ✅ **Fully feasible and straightforward.**

- **CPI depth:** The circuit breaker check is a **read-only account lookup** — no CPI required. The `sss-token::mint` instruction receives the Pyth price account as an additional read-only account, deserializes it using `pyth_sdk_solana::load_price_feed_from_account_info`, and checks the price. If outside the band, return `CircuitBreakerTripped` error.
- **Compute units:** Pyth price feed deserialization: ~5,000 CU. Price band check: ~500 CU. Total overhead: ~5,500 CU per mint. Negligible.
- **Account size:** `CircuitBreakerConfig` PDA: `["circuit-breaker", mint]` — ~96 bytes. Stores: pyth_price_feed (Pubkey), lower_bound (u64, in price × 10^-8), upper_bound (u64), cooldown_slots (u64). Rent: ~0.0010 SOL.
- **Auto-unpause:** Not possible without off-chain intervention — Solana programs can't self-schedule. A bot (or governance tx) must call `unpause` after the peg is restored. Circuit breaker only pauses automatically; human/governance unpauses.
- **Oracle staleness:** Pyth feeds can be stale. Must check `price_feed.get_current_price()?.valid_slot` against `clock.slot` — reject if stale by more than N slots (e.g., 25 slots = ~10 seconds).

**Minimal viable implementation:**
- `CircuitBreakerConfig` PDA with oracle feed pubkey, price bounds, max staleness slots
- Modify `mint` instruction: if `FLAG_CIRCUIT_BREAKER` is set, require `pyth_price_account` in accounts and check price band
- No changes to transfer hook — circuit breaker only gates minting, not transfers

---

### Feature 5: DAO Compliance Committee (Multisig + Timelock for Blacklist)

**Concept:** Instead of a single `compliance_authority` key controlling the blacklist, require M-of-N multisig approval with a timelock delay before blacklist additions take effect.

**Feasibility:** ✅ **Fully feasible — implemented as dedicated instructions, no transfer hook involvement.**

- **CPI depth:** Multisig and timelock can be implemented natively in `sss-token` (no external program CPI needed for the core logic), or via a CPI to Squads Protocol (battle-tested multisig). If using Squads CPI: depth 1 (user → SSS → Squads). Safe.
- **Compute units:** Multisig signature verification: ~10,000 CU per signer. For a 3-of-5 multisig, ~30,000 CU. Timelock check: ~500 CU. Total: ~30,500 CU per governance action. Acceptable.
- **Timelock implementation:** A `PendingBlacklistAction` PDA stores the proposed action + `execute_after_slot` (current_slot + timelock_slots). A separate `execute_blacklist_action` instruction checks `clock.slot >= execute_after_slot` before applying. Cancellable by a quorum before execution.
- **DaoCommitteeConfig PDA:** `["dao-committee", mint]` — stores committee members (Vec<Pubkey>, max 10), required_signatures (u8), timelock_slots (u64). At 10 members: 320 bytes + 9 bytes overhead = ~329 bytes, ~0.0024 SOL rent.
- **Signer validation:** Anchor's `#[account(signer)]` on each committee member key. For variable-size committees, use `remaining_accounts` and validate each key against `dao_committee.members`.

**Minimal viable implementation:**
- `DaoCommitteeConfig` PDA: members list, quorum threshold, timelock duration
- `PendingAction` PDA: `["pending-action", dao_committee, action_id]` — proposed action, approvals bitmask, execute_after_slot
- Instructions: `propose_blacklist_action`, `approve_action`, `execute_action`, `cancel_action`
- Existing `compliance_authority` gating replaced by DAO committee quorum when `FLAG_DAO_COMMITTEE` is set

---

### Feasibility Summary

| Feature | Feasible? | CPI Depth Used | CU Cost | Key Risk |
|---------|-----------|---------------|---------|---------|
| Spend Policies | ✅ Yes | 0 (same program) | ~35K CU in hook | Dynamic accounts in hook |
| Yield Collateral | ⚠️ With caveats | 2 levels | ~15K CU per deposit | External protocol risk |
| ZK Compliance Proofs | ⚠️ Complex | 0 (pre-verify) | ~500K CU pre-verify | Infrastructure complexity |
| Circuit Breaker | ✅ Yes | 0 (read-only) | ~5.5K CU in mint | Oracle staleness |
| DAO Committee | ✅ Yes | 0–1 (optional Squads) | ~30K CU per vote | On-chain key storage |

---

## Part 4 — Recommended Architecture

### Design Principle

**Every feature costs zero for builders who don't use it.** Zero accounts. Zero CU. Zero rent. The `feature_flags: u64` field in `StablecoinConfig` gates everything at the lowest possible cost. Feature-specific PDAs exist only when the feature is enabled.

### Proposed StablecoinConfig Layout

```rust
/// Global stablecoin configuration (one per mint).
#[account]
#[derive(InitSpace)]
pub struct StablecoinConfig {
    // ─── Core identity ────────────────────────────────────────────────────────
    pub mint: Pubkey,                        // 32
    pub authority: Pubkey,                   // 32
    pub compliance_authority: Pubkey,        // 32

    // ─── Feature gating ───────────────────────────────────────────────────────
    /// Preset tier for backward compatibility (1=SSS-1, 2=SSS-2, 3=SSS-3)
    pub preset: u8,                          // 1
    /// Bitmask of enabled optional features (see FLAG_* constants below)
    pub feature_flags: u64,                  // 8

    // ─── Core state ───────────────────────────────────────────────────────────
    pub paused: bool,                        // 1
    pub total_minted: u64,                   // 8
    pub total_burned: u64,                   // 8
    pub max_supply: u64,                     // 8

    // ─── SSS-2 / transfer hook ────────────────────────────────────────────────
    pub transfer_hook_program: Pubkey,       // 32 (Pubkey::default if unused)

    // ─── SSS-3 / reserve vault ────────────────────────────────────────────────
    pub collateral_mint: Pubkey,             // 32 (Pubkey::default if unused)
    pub reserve_vault: Pubkey,              // 32 (Pubkey::default if unused)
    pub total_collateral: u64,              // 8

    // ─── Two-step authority transfers ─────────────────────────────────────────
    pub pending_authority: Pubkey,           // 32 (Pubkey::default if none)
    pub pending_compliance_authority: Pubkey, // 32 (Pubkey::default if none)

    pub bump: u8,                            // 1
    // Reserved for future fields (costs only 40 bytes of rent now)
    pub _reserved: [u8; 40],               // 40
}
// Total: 8 (discriminator) + 309 (fields) + 40 (reserved) = 357 bytes
// Rent-exempt: ~0.0025 SOL (~$0.35 at $140/SOL)
```

### Feature Flag Constants

```rust
// ─── Feature flag bit positions ───────────────────────────────────────────────
// These are PERMANENT — bit positions must never be reused.

/// SSS-2: on-chain transfer hook + blacklist enforcement
pub const FLAG_TRANSFER_HOOK: u64       = 1 << 0;

/// SSS-2: permanent delegate extension on mint
pub const FLAG_PERMANENT_DELEGATE: u64  = 1 << 1;

/// SSS-3: reserve vault (collateral-backed minting)
pub const FLAG_RESERVE_VAULT: u64       = 1 << 2;

/// SSS-3: confidential transfers (Token-2022 ElGamal ZK)
pub const FLAG_CONFIDENTIAL: u64        = 1 << 3;

/// New: programmable spend policies (velocity limits, amount rules)
pub const FLAG_SPEND_POLICIES: u64      = 1 << 4;

/// New: yield-bearing collateral (Solend/MarginFi/Kamino integration)
pub const FLAG_YIELD_COLLATERAL: u64    = 1 << 5;

/// New: ZK compliance proofs (private blacklist with non-membership proofs)
pub const FLAG_ZK_COMPLIANCE: u64       = 1 << 6;

/// New: circuit breaker (Pyth oracle auto-pause on depeg)
pub const FLAG_CIRCUIT_BREAKER: u64     = 1 << 7;

/// New: DAO compliance committee (multisig + timelock for blacklist actions)
pub const FLAG_DAO_COMMITTEE: u64       = 1 << 8;

// Bits 9–63: reserved for future features. DO NOT use without updating this constant file.
```

### Feature-Specific PDAs (exist only when feature is enabled)

| Feature | PDA Seeds | Size | Rent |
|---------|-----------|------|------|
| SpendPolicyConfig | `["spend-policy", mint]` | 192 bytes | ~0.0021 SOL |
| Rule (per-rule) | `["rule", spend_policy, rule_id]` | 128 bytes | ~0.0014 SOL each |
| VelocityTracker | `["velocity", mint, wallet, window_slot]` | 48 bytes | ~0.0005 SOL |
| YieldVaultConfig | `["yield-vault", mint]` | 128 bytes | ~0.0014 SOL |
| ZkBlacklistRoot | `["zk-blacklist", mint]` | 80 bytes | ~0.0008 SOL |
| ProofVerification | `["zk-verify", wallet, tx_hash]` | 64 bytes | ephemeral (closed after use) |
| CircuitBreakerConfig | `["circuit-breaker", mint]` | 96 bytes | ~0.0010 SOL |
| DaoCommitteeConfig | `["dao-committee", mint]` | ~329 bytes | ~0.0024 SOL |
| PendingAction | `["pending-action", dao_committee, id]` | 160 bytes | ~0.0017 SOL (refunded on close) |

### How Presets Map to Feature Flags

The existing `preset` field is preserved for backward compatibility. New presets are defined as flag combinations:

```rust
/// Helper: preset flags for backward compatibility
pub fn preset_flags(preset: u8) -> u64 {
    match preset {
        1 => 0,                                                    // SSS-1: no optional features
        2 => FLAG_TRANSFER_HOOK | FLAG_PERMANENT_DELEGATE,        // SSS-2
        3 => FLAG_RESERVE_VAULT | FLAG_CONFIDENTIAL,             // SSS-3
        _ => 0,
    }
}

/// Example SSS-4 preset: SSS-2 compliance + circuit breaker + DAO committee
pub const SSS_4_FLAGS: u64 = FLAG_TRANSFER_HOOK
    | FLAG_PERMANENT_DELEGATE
    | FLAG_CIRCUIT_BREAKER
    | FLAG_DAO_COMMITTEE;

/// Example "DeFi-grade" preset: SSS-3 + yield collateral + spend policies
pub const SSS_DEFI_FLAGS: u64 = FLAG_RESERVE_VAULT
    | FLAG_CONFIDENTIAL
    | FLAG_YIELD_COLLATERAL
    | FLAG_SPEND_POLICIES;
```

### Instruction Guard Pattern

In every instruction handler, feature checks are a single bitwise AND:

```rust
// Inside mint instruction handler:
if config.feature_flags & FLAG_CIRCUIT_BREAKER != 0 {
    // Pyth price account is required; check price band
    let price_account = ctx.accounts.pyth_price_account.as_ref()
        .ok_or(SSSError::CircuitBreakerAccountRequired)?;
    let price = load_price_feed_from_account_info(price_account)?;
    circuit_breaker::check_peg(&price, &circuit_breaker_config)?;
}

if config.feature_flags & FLAG_SPEND_POLICIES != 0 {
    spend_policies::evaluate_rules(
        &ctx.accounts.spend_policy_config,
        &ctx.remaining_accounts,  // rule PDAs + velocity trackers
        amount,
        &ctx.accounts.minter.key(),
    )?;
}
```

Cost when the feature is NOT enabled: **1 CU** (one bitwise AND that short-circuits). Zero additional accounts needed. Zero rent. Perfect opt-out.

### Migration Path for Existing Deployments

1. **Program upgrade** adds `feature_flags: u64` and `_reserved: [u8; 40]` to `StablecoinConfig`. Existing accounts have these bytes pre-allocated — the `InitSpace` derivation already reserves exact space. For **existing accounts**, a migration instruction `migrate_config_v2(mint)` can be called once to realloc the account to the new size. The upgrade authority calls this; cost is the rent-exemption delta (~0.0003 SOL).

2. **Backward compatibility:** Existing SSS-1/2/3 presets continue to work. `preset` is still checked first in the `initialize` instruction. The `feature_flags` field is set to `preset_flags(preset)` on initialization. New features can only be enabled at init time initially; post-init feature enable/disable can be added in a follow-up PR.

### Build Order Recommendation

| Priority | Feature | Why |
|----------|---------|-----|
| 1 | `feature_flags` field + `_reserved` + migration | Unblocks everything else |
| 2 | Circuit Breaker | Highest risk-mitigation value, lowest complexity |
| 3 | Spend Policies | High demand (compliance use cases), spike already done |
| 4 | DAO Committee | High demand (regulatory), builds on existing compliance authority pattern |
| 5 | Yield Collateral | Significant revenue potential, moderate complexity |
| 6 | ZK Compliance | Highest complexity, needs careful audit, do last |

---

## Appendix: Quick Reference

### CPI Depth Budget for SSS-2 Transfer Hook

```
Token-2022 (level 1)
  └─ sss-transfer-hook (level 2)
       └─ [spend policy check — same program, no CPI cost]
       └─ [circuit breaker check — read-only, no CPI cost]
       └─ optional: compliance-program CPI (level 3)  ← last safe level
                    └─ [no further CPIs allowed — level 4 = hard limit]
```

### Max Realistic CU Costs (All Features Enabled)

| Scenario | CU |
|----------|-----|
| SSS-1 transfer (no features) | ~8,000 |
| SSS-2 transfer + blacklist | ~20,000 |
| SSS-4 transfer (all 5 new features) | ~90,000 |
| SSS-4 transfer with ZK pre-verify | ~550,000 |
| Hard limit per transaction | 1,400,000 |

All scenarios fit within the Solana compute budget.

### Rent Summary (All 5 Features Enabled)

| Feature PDAs | Total Rent |
|-------------|------------|
| All 5 feature configs | ~0.0078 SOL (~$1.09) |
| Per-rule PDAs (10 rules) | ~0.014 SOL (~$1.96) |
| Per-member PDAs (5 DAO members) | included in DaoCommitteeConfig |
| **Grand total (max config)** | **~0.022 SOL (~$3.08)** |

This is the maximum one-time cost for a fully-featured SSS-4 stablecoin issuer. It is not a recurring cost — rent-exempt accounts hold their lamports indefinitely.

---

*Research by sss-docs (2026-03-15). No code changes. All figures based on current Solana mainnet-beta parameters (Solana 1.18+). CU estimates are conservative upper bounds; actual costs may be 20–40% lower.*
