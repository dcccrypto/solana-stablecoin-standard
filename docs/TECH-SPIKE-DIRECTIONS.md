# Technical Architecture Spike — 5 Revolutionary SSS Directions

**Task:** SSS-033  
**Author:** sss-anchor  
**Date:** 2026-03-15  
**Status:** Spike complete — tests in `tests/spikes/` (82 passing)

---

## Overview

This document evaluates the on-chain feasibility of five advanced stablecoin directions for the Solana Stablecoin Standard. Each section covers: required accounts/instructions/CPIs, Solana constraints (compute units, account size limits, CPI depth), the hardest engineering challenge, and a rough level-of-effort (LoE) estimate in Anchor dev-days.

---

## Direction 1 — On-Chain Proof of Reserves (Merkle Tree)

### What It Is
A verifiable reserve attestation system: the issuer publishes a Merkle root of all depositor balances on-chain; any holder can submit an inclusion proof to verify their balance is included in the attested total.

### Accounts
| Account | Type | Size |
|---------|------|------|
| `ReserveMerkleRoot` | PDA (`["merkle-root", epoch]`) | 80 bytes (root hash 32B + epoch u64 + total_supply u64 + timestamp i64) |
| `ProofVerification` (ephemeral) | PDA or none | Compute-only; no persistent state needed |
| `Authority` | Signer | — |

### Instructions
- `update_merkle_root(root: [u8; 32], total_supply: u64, epoch: u64)` — issuer updates root each epoch
- `verify_inclusion(proof: Vec<[u8; 32]>, leaf_index: u64, address: Pubkey, balance: u64)` — anyone can call; succeeds or fails

### CPIs
None required — fully self-contained. Integration with **Light Protocol / ZK Compression** would add a CPI to the Light system program for compressed account reads, but the Merkle verification itself is on-chain pure SHA-256.

### Solana Constraints
- **Compute units:** SHA-256 is a syscall on Solana (`sol_sha256`). A proof of depth 20 (for 1M depositors) requires ~20 hash calls ≈ **20,000 CUs** — well within the 1.4M limit.
- **Account size:** `ReserveMerkleRoot` is 80 bytes — trivial. The full tree is off-chain (IPFS/Arweave); only the root goes on-chain.
- **ZK Compression option:** Light Protocol's `compressed_account` CPI would allow storing individual leaf commitments at near-zero rent cost, but adds CPI depth (1 level).

### Hardest Part
Building a trustless off-chain tree generator that matches the on-chain hash scheme exactly. A mismatch in leaf encoding (endianness, padding) will silently break all proofs. Requires a canonical leaf spec (`H(address || balance_le_u64)`) and a TypeScript + Rust implementation that agree.

### LoE Estimate
- Anchor program: **3 days**
- Off-chain tree builder + CLI: **2 days**
- SDK wrapper + docs: **1 day**
- **Total: ~6 dev-days**

---

## Direction 2 — Multi-Collateral CDP (Price Oracle + Liquidation Engine)

### What It Is
A Collateralized Debt Position vault that accepts multiple collateral token types (SOL, wBTC, wETH, etc.), enforces collateral ratios via live price feeds (Pyth/Switchboard), and liquidates undercollateralized positions.

### Accounts
| Account | Type | Size |
|---------|------|------|
| `CdpConfig` | PDA (`["cdp-config"]`) | 128 bytes |
| `CollateralType` | PDA (`["collateral", mint]`) | 96 bytes per collateral |
| `Vault` | PDA (`["vault", owner, vault_id]`) | 256 bytes |
| `PythPriceAccount` | External (Pyth) | Read-only |
| `SwitchboardAggregator` | External | Read-only |
| `LiquidationReward` | PDA (`["liquidation-reward"]`) | 64 bytes |

### Instructions
- `open_vault(collateral_mint: Pubkey, initial_deposit: u64)` — creates vault
- `deposit_collateral(vault: Pubkey, amount: u64)` — increases collateral
- `mint_stablecoin(vault: Pubkey, amount: u64)` — checks ratio, CPIs to SSS mint
- `repay(vault: Pubkey, amount: u64)` — burn stablecoin, reduce debt
- `withdraw_collateral(vault: Pubkey, amount: u64)` — enforces min ratio
- `liquidate(vault: Pubkey)` — callable by anyone when ratio < liquidation threshold

### CPIs
1. **Pyth SDK CPI** — `pyth_sdk_solana::load_price_feed_from_account_info` (no on-chain CPI; read-only account deserialization)
2. **Switchboard CPI** — `switchboard_v2::AggregatorAccountData::get_result` (same pattern)
3. **SSS Token CPI** — `sss_token::cpi::mint(...)` and `sss_token::cpi::burn(...)` to create/destroy the stablecoin
4. **Token-2022 CPI** — transfer collateral to/from vault escrow

### Solana Constraints
- **CPI depth:** 4 (CDP → SSS → Token-2022 → System). Max is 4. This is tight — if SSS itself calls into Token-2022, we're at the limit.
- **Compute units:** Price feed deserialization ~5,000 CU; ratio check ~2,000 CU; mint CPI ~10,000 CU. Total ~20,000 CU per normal op. Liquidation is heavier (multiple collateral types): ~80,000 CU.
- **Account size:** 256 bytes per vault is safe. Multi-collateral vaults with >4 collateral types need dynamic-sized accounts — use `realloc` or a separate `VaultCollateral` PDA per type.

### Hardest Part
**Oracle staleness and price manipulation**. Pyth prices can lag; liquidators could sandwich-attack price updates. Mitigations: confidence interval checks, TWAP fallback, minimum time between oracle update and liquidation. Getting this logic correct without blowing compute budget is the core challenge.

### LoE Estimate
- Anchor program (single collateral MVP): **5 days**
- Multi-collateral extension + oracle integration: **4 days**
- Liquidation bot (off-chain): **3 days**
- Tests + docs: **2 days**
- **Total: ~14 dev-days**

---

## Direction 3 — CPI Composability Standard

### What It Is
A trait-like interface definition in Anchor that allows any external Solana program to CPI into SSS mints in a standardized way — analogous to an ERC-20 `transfer` interface but for Solana.

### Design
Anchor doesn't have runtime interfaces, but we can define a **discriminator-based dispatch pattern**:

```
SSS_MINT_INTERFACE_NAMESPACE = "sss_mint_interface"
mint_discriminator       = sha256("global:mint")[..8]
burn_discriminator       = sha256("global:burn")[..8]
transfer_hook_discriminator = sha256("global:transfer_hook_execute")[..8]
```

Any program that wants to call an SSS-compatible mint:
1. Derives the discriminator for the instruction.
2. Constructs the account list per the published ABI.
3. Calls via `invoke` or `invoke_signed`.

### Accounts (per instruction)
`mint`: `[config (mut), minter_info (mut), mint (mut), destination (mut), minter (signer), token_program]`  
`burn`: `[config (mut), minter_info (mut), mint (mut), source (mut), minter (signer), token_program]`

### CPIs Required
Callers use native `invoke`/`invoke_signed` with the SSS program ID. No special CPI library needed — just the discriminator and account list from the IDL.

### Solana Constraints
- **CPI depth:** A program calling SSS-CPI consumes 1 depth level. SSS then calls Token-2022 (1 more). If the outer program was itself called (e.g., a router), depth = 3. Safe within the limit of 4.
- **Compute units:** CPI overhead is ~1,000–2,000 CU per call. Calling SSS mint via CPI costs ~12,000 CU total.
- **Account validation:** The SSS program checks `minter_info.authority == minter.key()` regardless of caller — composability doesn't weaken access control.

### Interface Spec (IDL fragment)
```json
{
  "name": "sss_mint_interface",
  "version": "1.0.0",
  "instructions": [
    { "name": "mint", "discriminator": [0x75,0xa7,0x97,0x89,0xa4,0x34,0xbe,0x23] },
    { "name": "burn", "discriminator": [0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88] }
  ]
}
```
Callers pin to a specific SSS program ID and version. Breaking interface changes require a new program address.

### Hardest Part
**IDL versioning and backward compatibility.** If a future SSS upgrade adds required accounts, existing callers break silently (wrong account count returns `AccountNotEnoughKeys`). Solution: explicit interface versioning in a `InterfaceVersion` PDA that callers can check before invoking.

### LoE Estimate
- Interface spec + IDL publication: **1 day**
- CPI stubs in Anchor (Rust feature): **2 days**
- TypeScript CPI client: **1 day**
- Integration test (external program → SSS): **1 day**
- Docs: **1 day**
- **Total: ~6 dev-days**

---

## Direction 4 — Programmable Compliance Rule Engine

### What It Is
On-chain rule PDAs that encode compliance policies (velocity limits, amount thresholds, multisig requirements). Rules are evaluated during mint/burn/transfer via the Transfer Hook, without blowing the compute budget.

### Accounts
| Account | Type | Size |
|---------|------|------|
| `RuleSet` | PDA (`["ruleset", config]`) | 64 + N×rule_size |
| `Rule` | PDA (`["rule", ruleset, rule_id]`) | 128 bytes |
| `VelocityTracker` | PDA (`["velocity", wallet, window_start]`) | 48 bytes |
| `Blacklist` | PDA (`["blacklist", address]`) | 32 bytes (existence = blacklisted) |
| `JurisdictionBlock` | PDA (`["jurisdiction-block", code]`) | 16 bytes |

### Rule Schema (128 bytes)
```
rule_type: u8           // 0=blacklist, 1=amount_limit, 2=velocity, 3=jurisdiction, 4=multisig
enabled: bool
params: [u8; 64]        // type-specific: threshold u64, window_seconds u64, etc.
error_code: u32
priority: u8            // evaluation order
```

### Instructions
- `add_rule(rule_type, params)` — admin only; creates Rule PDA
- `remove_rule(rule_id)` — admin only
- `update_rule(rule_id, params)` — admin only
- `check_compliance(accounts: [...rule PDAs], ctx: TransactionContext)` — called by Transfer Hook

### Compute Budget Strategy
The Transfer Hook must complete within the compute budget. Each rule costs:
- **Blacklist:** ~3,000 CU (PDA existence check = one `AccountInfo` deserialization)
- **Amount limit:** ~500 CU (comparison only)
- **Velocity:** ~5,000 CU (load PDA + update rolling sum + reserialize)
- **Jurisdiction:** ~3,000 CU (PDA existence check)

For a ruleset of 10 rules: ~35,000 CU. The Transfer Hook gets 400,000 CU (with `ComputeBudgetInstruction::set_compute_unit_limit`). This is comfortable for ≤20 rules.

**Key optimization:** Evaluate cheap rules first (amount limits ~500 CU), then expensive ones (velocity ~5,000 CU). Short-circuit on first failure.

### CPIs
None within the rule evaluation path. The Transfer Hook calls `check_compliance` as an internal instruction (same program or CPI to a compliance program). If separated into a dedicated program, that's 1 CPI level.

### Hardest Part
**Velocity tracker with rolling windows**. Solana's clock is only available as a sysvar; you can't iterate over historical windows. Pattern: store `window_start_slot` + `accumulated_amount` in the PDA. When a new transaction arrives, if `current_slot - window_start_slot > window_size_slots`, reset the window. This is approximate (slot-based, not wall-clock) but deterministic.

### LoE Estimate
- Core rule PDA + basic rule types (blacklist, amount): **3 days**
- Velocity tracker + window arithmetic: **2 days**
- Transfer Hook integration: **2 days**
- Admin SDK (add/remove/update rules): **1 day**
- Tests + docs: **2 days**
- **Total: ~10 dev-days**

---

## Direction 5 — Confidential Transfers + Selective Disclosure

### What It Is
Using the **Token-2022 Confidential Transfer** extension to keep balances and transfer amounts encrypted on-chain. An issuer or auditor holds a key that can decrypt all amounts; individual holders only see their own balance.

### Key Components
| Component | Description |
|-----------|-------------|
| `ElGamalKeypair` | Per-wallet keypair on Ristretto255 curve; public key stored on-chain in token account |
| `AES-GCM key` | Per-wallet symmetric key for the "decryptable balance" field |
| `ConfidentialTransferMint` | Token-2022 extension on the mint; holds auditor public key |
| `ConfidentialTransferAccount` | Token-2022 extension on each token account; holds encrypted balance |
| `WithheldAmount` | Accumulated encrypted fees; harvested via `harvest_withheld_tokens_to_mint` |

### Accounts (beyond standard Token-2022)
Token-2022 handles the account extensions automatically. SSS needs:
- Store `auditor_elgamal_pubkey` in `SssConfig` (32 bytes additional)
- `configure_confidential_transfer` instruction in SSS to set up mint extension

### Instructions to Add
- `enable_confidential_transfers(auditor_pubkey: ElGamalPubkey)` — one-time mint setup
- Standard Token-2022 confidential transfer instructions are called directly by clients (no SSS wrapper needed): `ApplyPendingBalance`, `Deposit`, `Withdraw`, `Transfer` with ZK proofs

### CPIs
- `spl_token_2022::instruction::configure_confidential_transfer_mint` — 1 CPI
- All confidential transfer instructions are called directly by the user's wallet (client-side), not via SSS

### Solana Constraints
- **Compute units:** ZK proof verification is the bottleneck. The `VerifyTransferWithFee` proof costs ~1.7M CU — **over the limit**. Solana 1.18+ allows splitting ZK proof verification into a separate `VerifyProof` instruction (pre-verification). This is mandatory.
- **Account size:** `ConfidentialTransferAccount` adds 286 bytes per token account. `ConfidentialTransferMint` adds 97 bytes to the mint.
- **CPI depth:** Confidential transfer instructions don't require SSS CPIs. Users call Token-2022 directly with pre-verified proofs.

### Auditor Key Pattern
```
ConfidentialTransferMint {
  auditor_elgamal_pubkey: Option<ElGamalPubkey>,  // if Some, all transfers encrypted to auditor too
  auto_approve_new_accounts: bool,
}
```
With an auditor key set, every confidential transfer encrypts the amount twice: once for the recipient's public key and once for the auditor's public key (using the `TransferWithAuditor` instruction). The auditor can decrypt all amounts offline using their `ElGamalSecretKey`.

### ElGamal Key Management
- Keys are **derived** from a wallet signature, not random — allowing deterministic re-derivation without backup.
- Derivation: `HKDF(sha512(sign("ElGamal keypair")), "sss-elgamal-v1")` → 64 bytes → scalar + public key
- The TypeScript SDK wraps this via `@solana/spl-token` helper `getElGamalKeypair(wallet, mint)`.

### Hardest Part
**ZK proof generation is client-side only** — the Rust crate `spl-token-2022` provides `TransferAmountCiphertext` and proof generation, but there's no pure-TypeScript equivalent. The SDK must either:
1. Call a Rust WASM module for proof generation (increases bundle size by ~2MB), or
2. Offload proof generation to a backend service (introduces trust).

Option 1 (WASM) is the trustless path. The `@solana/spl-token` v0.4+ includes the WASM prover for confidential transfers.

### LoE Estimate
- Mint-level setup (enable CT, set auditor key): **2 days**
- Client SDK (ElGamal keygen, deposit, withdraw, CT transfer): **3 days**
- WASM proof generation integration: **3 days**
- Auditor decrypt tool: **1 day**
- Tests + docs: **2 days**
- **Total: ~11 dev-days**

---

## Summary Table

| # | Direction | Key Constraint | Hardest Part | LoE (dev-days) |
|---|-----------|---------------|-------------|----------------|
| 1 | Proof of Reserves | ~20K CU/proof (fast) | Canonical leaf encoding alignment | **6** |
| 2 | Multi-Collateral CDP | CPI depth = 4 (tight) | Oracle staleness + liquidation safety | **14** |
| 3 | CPI Composability | +1 CPI depth per caller | IDL versioning / backward compat | **6** |
| 4 | Compliance Rule Engine | ~35K CU per Transfer Hook | Velocity tracker rolling windows | **10** |
| 5 | Confidential Transfers | ZK proof ~1.7M CU (must pre-verify) | WASM prover bundle / trustless proof gen | **11** |

**Recommended build order:** Direction 3 (CPI interface) first — it unlocks composability for Directions 1 and 4. Direction 1 (PoR) is the highest impact at lowest LoE. Direction 2 (CDP) is the biggest standalone feature. Direction 5 requires Solana 1.18+ ZK pre-verification support.
