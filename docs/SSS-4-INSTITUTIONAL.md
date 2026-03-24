# SSS-4 Institutional Preset — Squads Protocol V4 Multisig Guide

**Preset ID:** `PRESET_INSTITUTIONAL = 4`  
**Feature flag:** `FLAG_SQUADS_AUTHORITY = 1 << 15 (32768)`  
**Recommended for:** Any SSS stablecoin issuer holding **> $1 M in reserves**.

---

## Overview

SSS-4 extends SSS-3 (collateral-backed) with **Squads Protocol V4 native multisig authority**.  
Instead of a single hot key acting as the program authority, a Squads V4 multisig PDA takes over.  
This means minting, burning, blacklisting, pausing, and all governance operations require *m-of-n* approval from designated signers — enforced on-chain by the Squads program.

---

## Architecture

```
Issuer keypair A ──┐
Issuer keypair B ──┼──► Squads V4 Multisig PDA ──► SSS StablecoinConfig.authority
Custodian keypair ─┘
```

1. **`SquadsMultisigConfig` PDA** (`seeds = [b"squads-multisig-config", sss_mint]`)  
   Stores threshold, member list, and the Squads multisig PDA pubkey for SDK introspection.  
   Member list is informational — threshold enforcement is delegated to the Squads program.

2. **`init_squads_authority`** (one-time, irreversible)  
   Atomically:
   - Transfers `StablecoinConfig.authority` from the bare keypair to the Squads PDA.
   - Sets `FLAG_SQUADS_AUTHORITY` (bit 15) in `feature_flags`.
   - Sets `preset = PRESET_INSTITUTIONAL (4)`.
   - Creates the `SquadsMultisigConfig` PDA.

3. **`verify_squads_authority`** (read-only)  
   Checks that a given signer equals `squads_multisig`. Useful for SDK health checks.

4. **`verify_squads_signer` helper** (internal)  
   Called by authority-gated instruction handlers when `FLAG_SQUADS_AUTHORITY` is set.  
   Returns `SquadsSignerMismatch` if the signer is not the registered PDA.

---

## Setup Guide

### Step 1: Create a Squads V4 multisig

Use the [Squads app](https://app.squads.so) or SDK to create a new multisig:

```typescript
import { Multisig } from "@squads-protocol/multisig";

const { multisigPda } = await Multisig.create({
  connection,
  creator: issuerKeypair,
  threshold: 2,
  members: [memberA.publicKey, memberB.publicKey, custodian.publicKey],
  timeLock: 0,
});
```

Save the `multisigPda` — this becomes the new SSS authority.

### Step 2: Initialize Squads authority on SSS

```typescript
await program.methods
  .initSquadsAuthority({
    multisigPda,
    threshold: 2,
    members: [memberA.publicKey, memberB.publicKey, custodian.publicKey],
  })
  .accounts({
    authority: issuerKeypair.publicKey,  // current bare authority — signs this tx
    config: configPda,
    mint: sssTokenMint,
    squadsConfig: squadsConfigPda,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([issuerKeypair])
  .rpc();
```

After this call:
- `config.authority === multisigPda`
- `config.preset === 4`
- `config.feature_flags & FLAG_SQUADS_AUTHORITY !== 0`

**This is irreversible.** The original bare keypair can no longer unilaterally execute authority operations.

### Step 3: Execute authority operations via Squads CPI

All future authority-gated calls (mint, burn, freeze, pause, blacklist, guardian ops, timelock ops) must flow through the Squads execution path so `multisigPda` appears as the transaction signer.

Example: propose and approve a Squads multisig transaction for `pause`:

```typescript
// 1. Propose the SSS `pause` instruction inside a Squads transaction
const txIndex = await Multisig.createTransaction({
  connection,
  multisigPda,
  transactionMessage: pauseInstruction,  // your `sss_token.pause()` ix
  creator: memberA,
});

// 2. Each threshold signer approves
await Multisig.approve({ multisigPda, transactionIndex: txIndex, member: memberB });

// 3. Execute once threshold is reached
await Multisig.execute({ multisigPda, transactionIndex: txIndex });
```

---

## PDA Derivation

```typescript
const [squadsConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("squads-multisig-config"), mint.toBuffer()],
  SSS_PROGRAM_ID,
);
```

---

## On-Chain State Added

| Field / Account | Type | Description |
|---|---|---|
| `StablecoinConfig.squads_multisig` | `Pubkey` | Registered Squads PDA; `default()` if not configured |
| `StablecoinConfig.preset` | `u8` | Set to `4` after `init_squads_authority` |
| `FLAG_SQUADS_AUTHORITY` | `u64` | Bit 15 — irreversible flag |
| `SquadsMultisigConfig` PDA | account | Threshold + member list |

---

## Errors

| Code | Description |
|---|---|
| `SquadsAuthorityNotSet` | FLAG_SQUADS_AUTHORITY not set; Squads not configured |
| `SquadsAuthorityAlreadySet` | `init_squads_authority` called twice |
| `SquadsMultisigPdaInvalid` | Zero pubkey supplied as multisig PDA |
| `SquadsSignerMismatch` | Signer is not the registered multisig PDA |
| `SquadsThresholdZero` | Threshold must be ≥ 1 |
| `SquadsThresholdExceedsMembers` | Threshold > len(members) |
| `SquadsMembersEmpty` | No members supplied |
| `SquadsMembersTooMany` | More than 10 members |
| `SquadsDuplicateMember` | Duplicate pubkey in member list |

---

## Security Properties

- **No unilateral authority after init**: The bare keypair loses authority atomically in the same tx that configures Squads.
- **Threshold enforcement is on-chain**: Squads V4 validates m-of-n approvals on-chain before the multisig PDA signs any CPI.
- **Irreversibility**: `FLAG_SQUADS_AUTHORITY` cannot be cleared via `set_feature_flags`. Once set, the program will always require the Squads PDA as the authority signer.
- **PDA-only signer**: SSS validates only the PDA address — member management, key rotation, and threshold changes remain under Squads governance.

---

## Recommended Configuration

| Issuer size | Threshold | Members | Notes |
|---|---|---|---|
| < $100 K | 2-of-3 | 3 founders | Minimum viable multisig |
| $100 K–$1 M | 3-of-5 | 3 founders + 2 advisors | Good balance of security + availability |
| > $1 M | 3-of-5+ with timelock | Founders + legal counsel + custodian | Required for institutional grade |

Enable `admin_timelock_delay` (SSS-085) alongside SSS-4 for defense-in-depth: even if the Squads multisig is compromised, timelocked operations give time to detect and respond before execution.
