<p align="center">
  <img src="https://img.shields.io/badge/Anchor-0.32-blue?style=for-the-badge" alt="Anchor" />
  <img src="https://img.shields.io/badge/Solana-2.3-9945FF?style=for-the-badge&logo=solana&logoColor=white" alt="Solana" />
  <img src="https://img.shields.io/badge/Kani-75%20proofs-green?style=for-the-badge" alt="Kani Proofs" />
</p>

# SSS On-Chain Programs

**Anchor programs powering the Solana Stablecoin Standard.**

Three programs deployed on Solana devnet, providing 60+ instructions for stablecoin lifecycle management, compliance enforcement, and composability.

---

## Programs

### sss-token (Core)

**Program ID:** `ApQTVMKdtUUrGXgL6Hhzt9W2JFyLt6vGnHuimcdXe811`

The core stablecoin program with 60+ instructions covering:

| Category | Instructions |
|---|---|
| **Lifecycle** | `initialize`, `mint`, `burn`, `pause`, `unpause` |
| **Roles** | `set_minter`, `remove_minter`, `set_freeze_authority` |
| **Compliance** | `freeze`, `thaw`, `add_to_blacklist`, `remove_from_blacklist` |
| **CDP** | `deposit_collateral`, `borrow_stable`, `repay_stable`, `liquidate` |
| **Oracle** | `set_oracle_params`, `add_oracle_source`, `update_oracle_consensus` |
| **Governance** | `init_dao_committee`, `propose_action`, `vote`, `execute_proposal` |
| **Feature Flags** | `set_feature_flag`, `clear_feature_flag` |
| **Guardian** | `guardian_pause`, `guardian_unpause` |
| **Timelock** | `propose_admin_action`, `execute_admin_action` |
| **Bridge** | `bridge_lock`, `bridge_release` |
| **Redemption** | `init_redemption_queue`, `enqueue`, `process`, `cancel` |
| **CPI** | `cpi_mint`, `cpi_burn` |
| **PBS/APC** | Probabilistic vaults, agent payment channels |

**Key files:**

```
programs/sss-token/src/
+-- lib.rs              # Program entrypoint + instruction dispatch
+-- instructions/       # 60+ instruction handlers (one per file)
+-- state.rs            # 23 PDA account structs
+-- error.rs            # Error enum (80+ variants)
+-- events.rs           # 13 event types
+-- proofs.rs           # 75 Kani formal verification proofs
```

---

### transfer-hook (Blacklist Enforcement)

**Program ID:** `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

Token-2022 transfer hook that enforces on-chain blacklist checks on every token transfer. Used by SSS-2 and SSS-3 presets.

- Reads `ExtraAccountMetaList` for blacklist PDA lookup
- Rejects transfers involving blacklisted addresses
- Zero overhead for non-blacklisted transfers

---

### cpi-caller (Test Program)

**Program ID:** `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof`

Test program for verifying CPI composability. External programs use the `sss-cpi` crate to invoke `cpi_mint` and `cpi_burn` through this pattern.

---

## Building

```bash
# Build all programs
anchor build

# Build outputs
ls target/deploy/       # .so files
ls target/idl/          # IDL JSON files

# Sync IDL to SDK after build
cp target/idl/sss_token.json sdk/src/idl/sss_token.json
```

---

## Testing

```bash
# Full integration test suite (builds + starts localnet)
anchor test

# Skip rebuild (faster iteration)
anchor test --skip-build

# Rust linting
cargo clippy -- -D warnings
```

---

## Formal Verification

75 Kani proofs verify critical invariants:

- Arithmetic overflow safety on all checked operations
- PDA seed collision resistance
- Config struct field isolation
- Feature flag bit independence
- Adversarial state transition scenarios

```bash
cargo kani    # Run all 75 proofs
```

See [formal-verification.md](../docs/formal-verification.md) for the full proof catalog.

---

## Security Invariants

- **All arithmetic uses `checked_*` operations** — enforced by `overflow-checks = true`
- **New instructions require Kani proofs** in `proofs.rs`
- **Feature flag bits must not collide** — see `state.rs` and `crates/sss-cpi/src/flags.rs`
- **Pause checks on entry** — all mutable instructions verify `!config.paused`
- **Authority checks** — every privileged instruction validates signer against stored authority

---

## License

Apache 2.0
