# Supply Cap Enforcement & PoR Breach Mint Halt (SSS-145)

**Feature flag:** `FLAG_POR_HALT_ON_BREACH = 1 << 16 (65536)`  
**Anchor errors:** `SupplyCapAndMinterCapBothZero`, `PoRNotAttested`, `PoRBreachHaltsMinting`  
**Event:** `MintHaltedByPoRBreach`

---

## Overview

SSS-145 closes two critical audit findings from the [design audit (PR #211)](AUDIT-DESIGN-DOCS.md):

| Finding | Problem | Fix |
|---|---|---|
| **CRITICAL-1** | `max_supply = 0` + `minter_info.cap = 0` allowed unlimited uncapped minting | Mint instruction now rejects if both caps are zero |
| **CRITICAL-2** | PoR breach only emitted an event — minting was not halted | `FLAG_POR_HALT_ON_BREACH` causes mint to read the PoR PDA and reject if `last_verified_ratio_bps < min_reserve_ratio_bps` |

---

## Supply Cap Invariant

**Rule:** At least one of `StablecoinConfig.max_supply` or `MinterInfo.cap` must be > 0.

If both are zero the instruction returns `SupplyCapAndMinterCapBothZero`. This prevents accidentally deploying a stablecoin with no collateral ceiling.

**Recommended configuration:**

```typescript
// Global supply ceiling
config.max_supply = 1_000_000_000_000; // 1 billion (6 decimal places = $1M max)

// Per-minter allocation (optional — set to 0 to rely on global cap only)
minterInfo.cap = 100_000_000_000; // $100K ceiling for this minter
```

---

## PoR Breach Halt

When `FLAG_POR_HALT_ON_BREACH` is set in `feature_flags`, every mint call must pass the `ProofOfReserves` PDA as `remaining_accounts[0]`.

The instruction checks:

1. **PDA derivation** — `seeds = [b"proof-of-reserves", mint]` must match `remaining_accounts[0].key`.
2. **Attestation present** — `por.last_attestation_slot > 0` (rejects with `PoRNotAttested` if never attested).
3. **Ratio check** — `por.last_verified_ratio_bps >= config.min_reserve_ratio_bps` (rejects with `PoRBreachHaltsMinting` + emits `MintHaltedByPoRBreach` if below threshold).

### Enabling the flag

```typescript
await program.methods
  .setFeatureFlags(FLAG_POR_HALT_ON_BREACH)  // OR with existing flags
  .accounts({ authority, config, mint })
  .rpc();
```

### Minting with PoR breach halt enabled

```typescript
const [porPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("proof-of-reserves"), mint.toBuffer()],
  SSS_PROGRAM_ID,
);

await program.methods
  .mintTokens(new BN(amount))
  .accounts({
    minter: minterKeypair.publicKey,
    config: configPda,
    mint: sssTokenMint,
    minterInfo: minterInfoPda,
    recipientTokenAccount,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .remainingAccounts([{ pubkey: porPda, isWritable: false, isSigner: false }])
  .signers([minterKeypair])
  .rpc();
```

---

## MintHaltedByPoRBreach Event

Emitted when a mint is rejected due to a PoR ratio breach:

```rust
pub struct MintHaltedByPoRBreach {
    pub mint: Pubkey,
    pub current_ratio_bps: u64,   // actual reserve ratio (basis points)
    pub min_ratio_bps: u64,        // required minimum ratio
    pub last_attestation_slot: u64,
    pub attempted_amount: u64,
}
```

Index this event via the [Indexer Guide](INDEXER-GUIDE.md) to trigger real-time alerts when minting is halted.

---

## Error Reference

| Error | Condition |
|---|---|
| `SupplyCapAndMinterCapBothZero` | Both `config.max_supply` and `minter_info.cap` are 0 |
| `PoRNotAttested` | FLAG_POR_HALT_ON_BREACH set but no PoR PDA passed, or `last_attestation_slot == 0` |
| `PoRBreachHaltsMinting` | Current PoR ratio is below `min_reserve_ratio_bps` |

---

## Interaction with Other Features

- **[Proof of Reserves](PROOF-OF-RESERVES.md)** — The PoR PDA must be kept fresh by the issuer (or oracle). Stale attestations (enforced by the staleness window in SSS-123) will cause minting to halt.
- **[Circuit Breaker](GUARDIAN-PAUSE.md)** — `FLAG_CIRCUIT_BREAKER` (SSS-107) is checked before PoR. Both halts are independent.
- **[SSS-4 Institutional](SSS-4-INSTITUTIONAL.md)** — Squads multisig authority adds m-of-n governance over `setFeatureFlags`, preventing a single compromised key from disabling `FLAG_POR_HALT_ON_BREACH`.

---

## Security Notes

- **Do not set `max_supply = 0` without a per-minter cap.** The program now rejects this configuration, but issuers migrating from pre-SSS-145 deployments should audit existing `MinterInfo` accounts.
- **PoR halt requires live attestations.** If the oracle stops submitting, `FLAG_POR_HALT_ON_BREACH` will halt all minting. This is the safe-fail direction: minting stops rather than continuing with stale data.
- **No bypass path.** The PoR check cannot be skipped by passing a wrong PDA — the instruction verifies PDA derivation before deserializing.
