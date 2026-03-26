# Proof of Reserves

> **SSS-123 — On-Chain PoR Attestation**  
> A fully on-chain Proof-of-Reserves mechanism. Whitelisted attestors write signed reserve claims to a `ProofOfReserves` PDA; anyone can verify the ratio and inspect the breach threshold on-chain.

---

## Overview

SSS supports two complementary PoR mechanisms:

| Mechanism | Implementation | Trust Model |
|---|---|---|
| **Supply Snapshot** (legacy, Direction 1) | Backend off-chain SHA-256 commitment | Trust backend + Solana RPC |
| **On-Chain PoR** (SSS-123) | `ProofOfReserves` Anchor PDA | Trustless — verify on-chain |

The on-chain mechanism (SSS-123) is the authoritative source of truth and is covered in full below.

---

## Architecture

### ProofOfReserves PDA

One `ProofOfReserves` account is created per stablecoin mint.

**Seeds:** `["proof-of-reserves", sss_mint]`

| Field | Type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | The stablecoin mint this record belongs to |
| `reserve_amount` | `u64` | Last submitted reserve amount (collateral token native units) |
| `attestation_hash` | `[u8; 32]` | 32-byte SHA-256 of the off-chain audit report or Pyth price feed id |
| `attestor` | `Pubkey` | Pubkey of the entity that submitted the latest attestation |
| `last_attestation_slot` | `u64` | Solana slot when the latest attestation was submitted |
| `last_verified_ratio_bps` | `u64` | Last computed reserve ratio (basis points; set by `verify_reserve_ratio`) |
| `bump` | `u8` | PDA bump |

### StablecoinConfig additions

SSS-123 adds two fields to `StablecoinConfig`:

| Field | Type | Description |
|---|---|---|
| `min_reserve_ratio_bps` | `u16` | Breach threshold (0 = disabled). E.g. `9500` = 95%. |
| `reserve_attestor_whitelist` | `[Pubkey; 4]` | Up to 4 custodian pubkeys authorised to attest |

---

## Instructions

### `submit_reserve_attestation`

Submit or refresh a reserve claim.

**Who can call:** `config.authority`, `config.expected_pyth_feed`, or any pubkey in `reserve_attestor_whitelist`.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `reserve_amount` | `u64` | Claimed reserve amount in collateral token native units. Must be > 0. |
| `attestation_hash` | `[u8; 32]` | SHA-256 of off-chain audit evidence or Pyth price feed id |

**Accounts:**

| Account | Mutability | Description |
|---|---|---|
| `attestor` | `mut`, signer | The submitting authority/custodian |
| `config` | read | `StablecoinConfig` PDA — validates attestor eligibility |
| `proof_of_reserves` | `mut`, `init_if_needed` | `ProofOfReserves` PDA (created on first call) |
| `system_program` | — | Required for `init_if_needed` |

**Events emitted:** `ReserveAttestationSubmitted`

---

### `verify_reserve_ratio`

Compute `reserve_amount * 10_000 / net_supply` and emit the result.  
If the ratio falls below `config.min_reserve_ratio_bps`, also emits `ReserveBreach`.

**Who can call:** Anyone (read-only on config; keepers and monitoring bots are the primary callers).

**Accounts:**

| Account | Mutability | Description |
|---|---|---|
| `config` | read | `StablecoinConfig` PDA |
| `proof_of_reserves` | `mut` | `ProofOfReserves` PDA — stores `last_verified_ratio_bps` |

**Events emitted:** `ReserveRatioEvent`, optionally `ReserveBreach`

---

### `get_reserve_status`

Read-only instruction that logs all reserve state via `msg!`.  
Returns `(reserve_amount, net_supply, ratio_bps, last_attestation_slot, attestor)`.

**Who can call:** Anyone.

---

### `set_reserve_attestor_whitelist`

Replace the reserve attestor whitelist on `StablecoinConfig`. Max 4 entries. Pass empty vec to clear.

**Who can call:** `config.authority` only.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `whitelist` | `Vec<Pubkey>` | New whitelist (0–4 entries) |

---

## Events

### `ReserveAttestationSubmitted`

Emitted on every successful `submit_reserve_attestation` call.

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `attestor` | `Pubkey` | Submitting authority |
| `reserve_amount` | `u64` | New claimed reserve |
| `attestation_hash` | `[u8; 32]` | Audit evidence hash |
| `slot` | `u64` | Solana slot |
| `prev_reserve_amount` | `u64` | Previous reserve (useful for change detection) |

---

### `ReserveRatioEvent`

Emitted by every `verify_reserve_ratio` call.

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `reserve_amount` | `u64` | Reserve used in calculation |
| `net_supply` | `u64` | Circulating supply at verification time |
| `ratio_bps` | `u64` | `reserve / supply × 10,000`. `10000` = 100%. |
| `last_attestation_slot` | `u64` | Slot of the most recent attestation |
| `attestor` | `Pubkey` | Most recent attestor |

---

### `ReserveBreach`

Emitted when `ratio_bps < config.min_reserve_ratio_bps` (and `min_reserve_ratio_bps > 0`).

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `reserve_amount` | `u64` | Current reserve |
| `net_supply` | `u64` | Current supply |
| `ratio_bps` | `u64` | Computed ratio |
| `min_ratio_bps` | `u16` | Threshold that was breached |
| `slot` | `u64` | Slot of last attestation |

> **Action required:** Integrators should monitor for `ReserveBreach` events and alert on-call operators immediately.

---

## SDK Usage

### Submit an Attestation

```typescript
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { sssProgram } from '@stbr/sss-token';
import crypto from 'crypto';

const mint = new PublicKey('TokenMintAddressHere11111111111111111111111');
const evidenceHash = crypto.createHash('sha256').update(auditReportBytes).digest();

await program.methods
  .submitReserveAttestation(
    new BN(100_000_000_000),   // reserve_amount in collateral base units
    Array.from(evidenceHash),   // [u8; 32]
  )
  .accounts({
    attestor: wallet.publicKey,
    config: configPda,
    proofOfReserves: proofOfReservesPda,
    systemProgram: SystemProgram.programId,
  })
  .signers([wallet])
  .rpc();
```

### Verify the Reserve Ratio

```typescript
await program.methods
  .verifyReserveRatio()
  .accounts({
    config: configPda,
    proofOfReserves: proofOfReservesPda,
  })
  .rpc();
```

### Read Reserve Status (off-chain)

```typescript
const por = await program.account.proofOfReserves.fetch(proofOfReservesPda);

console.log('Reserve amount:  ', por.reserveAmount.toString());
console.log('Last ratio (bps):', por.lastVerifiedRatioBps.toString());
console.log('Last slot:       ', por.lastAttestationSlot.toString());
console.log('Attestor:        ', por.attestor.toBase58());
```

### Derive PDAs

```typescript
import { PublicKey } from '@solana/web3.js';

const [proofOfReservesPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('proof-of-reserves'), mint.toBuffer()],
  SSS_PROGRAM_ID,
);

const [configPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('stablecoin-config'), mint.toBuffer()],
  SSS_PROGRAM_ID,
);
```

---

## Formal Verification (Kani)

SSS-123 ships three Kani harness proofs in `programs/sss-token/src/proofs.rs`:

| Proof | Guarantee |
|---|---|
| `proof_reserve_ratio_never_misreported` | `ratio_bps = reserve * 10_000 / supply` is always computed correctly (no overflow, correct zero-supply edge case). |
| `proof_reserve_breach_condition_correct` | `ReserveBreach` is emitted **if and only if** `ratio_bps < min_ratio_bps && min_ratio_bps > 0`. |
| `proof_reserve_attestation_stores_latest` | After `submit_reserve_attestation`, the PDA always reflects the latest submitted `reserve_amount` and `attestation_hash`. |

Run proofs:

```bash
cd programs/sss-token
cargo kani --harness proof_reserve_ratio_never_misreported
cargo kani --harness proof_reserve_breach_condition_correct
cargo kani --harness proof_reserve_attestation_stores_latest
```

---

## Operational Runbook

### Setting a Reserve Breach Threshold

```bash
# Set minimum reserve ratio to 95% (9500 bps)
anchor run set-min-reserve-ratio -- --mint <MINT> --bps 9500
```

### Adding a Custodian Attestor

```bash
anchor run set-reserve-whitelist -- \
  --mint <MINT> \
  --keys <CUSTODIAN_1_PUBKEY>,<CUSTODIAN_2_PUBKEY>
```

### Monitoring Breach Events

Subscribe to `ReserveBreach` log events using the event indexer (see [INDEXER-GUIDE.md](../docs/INDEXER-GUIDE.md)):

```typescript
program.addEventListener('ReserveBreach', (event) => {
  alertOncall(`RESERVE BREACH: ${event.mint} ratio=${event.ratioBps}bps min=${event.minRatioBps}bps`);
});
```

---

## Error Reference

| Error Code | Name | Cause |
|---|---|---|
| `Unauthorized` | `Unauthorized` | Caller is not authority, Pyth feed, or whitelisted attestor |
| `ZeroAmount` | `ZeroAmount` | `reserve_amount` passed as 0 |
| `InvalidVault` | `InvalidVault` | `proof_of_reserves.sss_mint` does not match `config.mint` |
| `ReserveAttestorWhitelistFull` | `ReserveAttestorWhitelistFull` | Whitelist exceeds 4 entries |

---

## Legacy: Supply Snapshot (Direction 1)

The original backend-based supply snapshot proof (SHA-256 Merkle root over `totalSupply`) remains available via the REST API for backwards compatibility.

**Endpoint:** `GET /api/reserves/proof?mint=<MINT>`

This returns a `merkle_root` computed as `SHA-256(SHA-256(supply_le8))` tied to a Solana slot. Use the on-chain PoR PDA as the primary source of truth; the REST endpoint is suitable for dashboards and lightweight clients that do not hold an RPC connection.

**Current limitations to be aware of:**
- The `holder` query parameter is accepted but not used to filter the proof.
- The snapshot reflects devnet state; mainnet support is forthcoming.
- The proof covers total supply only, not individual reserve wallet balances.
- **Reserve composition is self-reported, not machine-verified.** The PoR proof commits to the on-chain `totalSupply` — it does not verify what assets back that supply. An issuer supplies the reserve breakdown (e.g. "100% USD cash") separately; the protocol has no mechanism to verify this claim on-chain. Users relying on reserve composition figures should require off-chain auditor attestations in addition to the PoR Merkle proof. Direction 3 (oracle-attested proof) is planned to address this gap, but is not yet implemented.

---

---

## On-Chain Enforcement — FLAG_POR_HALT_ON_BREACH (BUG-008 / AUDIT-G6 / AUDIT-H4)

> **Fixed in commit `d1b011c`** — Previously, `FLAG_POR_HALT_ON_BREACH` (bit 16) was defined in `state.rs` but never read by `mint.rs` or `cpi_mint.rs`. Setting the flag had zero effect on minting. This section documents the corrected behaviour.

### ProofOfReserves PDA

An on-chain attestation record holds the latest reserve ratio submitted by an authorised oracle/keeper.

**Seeds:** `[b"proof-of-reserves", mint]`

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | The stablecoin mint this record belongs to |
| `last_attestation_slot` | `u64` | Slot when the most recent attestation was submitted |
| `last_verified_ratio_bps` | `u64` | Attested reserve ratio in basis points (e.g. `10_000` = 100% backed) |
| `attester` | `Pubkey` | Authority allowed to submit attestations |
| `bump` | `u8` | PDA bump seed |

### Instructions

#### `init_proof_of_reserves(attester: Pubkey)`

Called by the stablecoin authority to create the `ProofOfReserves` PDA for a mint. Must be done before enabling `FLAG_POR_HALT_ON_BREACH`.

**Accounts:**

| Account | Role |
|---|---|
| `payer` | Pays for account creation |
| `authority` | Stablecoin config authority (signer) |
| `config` | `StablecoinConfig` PDA — validates authority |
| `mint` | The stablecoin mint |
| `proof_of_reserves` | New PDA (init, seeds = `[b"proof-of-reserves", mint]`) |
| `system_program` | — |

```typescript
await program.methods
  .initProofOfReserves(attesterKeypair.publicKey)
  .accounts({ payer, authority, config, mint, proofOfReserves })
  .rpc();
```

#### `attest_proof_of_reserves(verified_ratio_bps: u64)`

Submitted by the designated attester (oracle / keeper) to update the on-chain reserve ratio.

**Accounts:**

| Account | Role |
|---|---|
| `attester` | Authorised attester (signer) |
| `mint` | The stablecoin mint |
| `proof_of_reserves` | Existing PDA (mutable) |

```typescript
const ratioBps = BigInt(9_800); // 98% backed

await program.methods
  .attestProofOfReserves(ratioBps)
  .accounts({ attester, mint, proofOfReserves })
  .rpc();
```

### Mint Enforcement Logic

When `FLAG_POR_HALT_ON_BREACH` is set in `StablecoinConfig.feature_flags`, every call to `mint` or `cpi_mint` **must** pass the `ProofOfReserves` PDA as `remaining_accounts[0]`. The instruction enforces three checks in order:

1. **PDA key verification** — `remaining_accounts[0].key()` must match the expected PDA derived from `seeds = [b"proof-of-reserves", mint]`. Fake accounts are rejected.
2. **Attestation present** — `por.last_attestation_slot > 0`. Returns `PoRNotAttested` if never attested.
3. **Ratio check** — `por.last_verified_ratio_bps >= config.min_reserve_ratio_bps`. If below threshold, emits `MintHaltedByPoRBreach` and returns `PoRBreachHaltsMinting`.

> **Special case:** `min_reserve_ratio_bps = 0` disables the ratio check — the flag then only requires a fresh attestation to exist, not a minimum ratio. This is not recommended in production.

```typescript
import { FLAG_POR_HALT_ON_BREACH } from '@stbr/sss-token';

// Minting with PoR breach halt enabled
const [porPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('proof-of-reserves'), mint.toBuffer()],
  program.programId,
);

await program.methods
  .mint(new BN(amount))
  .accounts({ authority, config, minterInfo, mint, tokenAccount, tokenProgram })
  .remainingAccounts([{ pubkey: porPda, isWritable: false, isSigner: false }])
  .rpc();
```

### New Errors

| Error | Code | Description |
|---|---|---|
| `PoRNotAttested` | `SssError` | `remaining_accounts[0]` has `last_attestation_slot == 0` — attestation never submitted |
| `PoRBreachHaltsMinting` | `SssError` | `last_verified_ratio_bps < min_reserve_ratio_bps` — minting blocked |

### MintHaltedByPoRBreach Event

Emitted on every `PoRBreachHaltsMinting` rejection to enable keeper/monitoring alerting.

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint that was blocked |
| `current_ratio_bps` | `u64` | Reserve ratio at time of attempted mint |
| `min_ratio_bps` | `u64` | Configured minimum ratio |
| `last_attestation_slot` | `u64` | Slot of the last on-chain attestation |
| `attempted_amount` | `u64` | Amount that was attempted to be minted |

```typescript
// Monitor breach events
program.addEventListener('MintHaltedByPoRBreach', (event) => {
  console.error(
    `MINT HALTED: mint=${event.mint.toBase58()} ` +
    `ratio=${event.currentRatioBps}bps (min=${event.minRatioBps}bps) ` +
    `slot=${event.lastAttestationSlot} attempted=${event.attemptedAmount}`
  );
  // Trigger pager alert / Discord notification
});
```

### Recommended Setup

```typescript
// 1. Set minimum reserve ratio on the config (e.g. 95%)
await program.methods
  .updateConfig({ minReserveRatioBps: 9_500 })
  .accounts({ authority, config, mint })
  .rpc();

// 2. Initialise the PoR PDA with a trusted attester
await program.methods
  .initProofOfReserves(attester.publicKey)
  .accounts({ payer, authority, config, mint, proofOfReserves })
  .rpc();

// 3. Submit an initial attestation before enabling the flag
await program.methods
  .attestProofOfReserves(new BN(10_000)) // 100% initially
  .accounts({ attester, mint, proofOfReserves })
  .rpc();

// 4. Enable the flag
await program.methods
  .setFeatureFlags(FLAG_POR_HALT_ON_BREACH)
  .accounts({ authority, config, mint })
  .rpc();
```

---

## Related Documentation

- [Architecture](ARCHITECTURE.md) — Three-layer system design
- [Formal Verification](formal-verification.md) — Kani mathematical proofs
- [Preset: SSS-3 Trustless](SSS-3.md) — Collateral-backed stablecoin design
- [Supply Cap & PoR Halt](SUPPLY-CAP-POR-HALT.md) — SSS-145 full feature reference
