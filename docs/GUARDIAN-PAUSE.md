# SSS Guardian Multisig Emergency Pause

Introduced in **SSS-121**. Allows a registered set of guardian keys to pause
a stablecoin mint without authority involvement, using an on-chain multisig
vote.

---

## Overview

The guardian system adds two PDAs to each stablecoin deployment:

| PDA | Seeds | Purpose |
|---|---|---|
| `GuardianConfig` | `["guardian-config", config_pubkey]` | Stores guardian pubkeys, threshold, and pending lift-votes |
| `PauseProposal` | `["pause-proposal", config_pubkey, proposal_id_le_bytes]` | Accumulates YES votes for a single pause request |

**Guardrails:** Guardians can only pause/unpause.  They cannot mint, burn,
change fees, alter collateral config, or do anything else to the protocol.

---

## Instruction Reference

### `init_guardian_config`

Registers guardians for a stablecoin. Authority-only, one-time.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | ✓ | ✓ | Config authority (payer) |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint (matches `config.mint`) |
| `guardian_config` | ✓ (init) | — | New `GuardianConfig` PDA |
| `token_program` | — | — | Token program |
| `system_program` | — | — | System program |

**Parameters**

| Parameter | Type | Constraints |
|---|---|---|
| `guardians` | `Vec<Pubkey>` | 1–7 unique pubkeys |
| `threshold` | `u8` | ≥1, ≤`guardians.len()` |

```typescript
await client.initGuardianConfig({
  configPda,
  guardians: [guardian1.publicKey, guardian2.publicKey, guardian3.publicKey],
  threshold: 2, // 2-of-3
});
```

---

### `guardian_propose_pause`

Any registered guardian opens a pause proposal. If threshold is 1 the pause
applies immediately.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `guardian` | ✓ | ✓ | Registered guardian (payer for proposal PDA) |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint |
| `guardian_config` | ✓ | — | `GuardianConfig` PDA (increments `next_proposal_id`) |
| `proposal` | ✓ (init) | — | New `PauseProposal` PDA |
| `system_program` | — | — | System program |

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `reason` | `[u8; 32]` | Freeform incident tag (e.g. ASCII string or 32-byte hash) |

```typescript
const reasonBytes = Buffer.from("oracle-price-anomaly".padEnd(32, "\0"));
const { proposalId } = await client.guardianProposePause({
  configPda,
  guardianKeypair: guardian1,
  reason: reasonBytes,
});
```

---

### `guardian_vote_pause`

Cast a YES vote on an open proposal. Once `votes.len() >= threshold` the
pause is applied and the proposal is marked `executed`.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `guardian` | ✓ | ✓ | Registered guardian voting |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint |
| `guardian_config` | — | — | `GuardianConfig` PDA |
| `proposal` | ✓ | — | Target `PauseProposal` PDA |

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `proposal_id` | `u64` | ID of the proposal to vote on |

```typescript
await client.guardianVotePause({
  configPda,
  guardianKeypair: guardian2,
  proposalId,
});
```

---

### `guardian_lift_pause`

Lift a guardian-imposed (or any) pause.

| Caller | Requirement |
|---|---|
| Config `authority` | Unconditional — single signature lifts immediately |
| Guardian | Must accumulate votes from **all** registered guardians (full quorum) |

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `caller` | — | ✓ | Authority or a guardian |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint |
| `guardian_config` | ✓ | — | `GuardianConfig` PDA (accumulates lift votes) |

```typescript
// Authority fast path
await client.guardianLiftPause({ configPda, callerKeypair: authorityKeypair });

// Guardian full-quorum path — each guardian calls this once
for (const g of [guardian1, guardian2, guardian3]) {
  await client.guardianLiftPause({ configPda, callerKeypair: g });
}
```

---

## On-Chain Events

| Event | Emitted when |
|---|---|
| `GuardianPauseProposed` | `guardian_propose_pause` creates a new proposal |
| `GuardianPauseVoted` | `guardian_vote_pause` records a vote |
| `MintPausedEvent` | Threshold reached — mint paused |
| `GuardianPauseLifted` | Pause lifted (field `by_quorum: bool` distinguishes path) |

---

## PDA Derivation

```typescript
import { PublicKey } from "@solana/web3.js";

// GuardianConfig
const [guardianConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("guardian-config"), configPda.toBuffer()],
  SSS_PROGRAM_ID,
);

// PauseProposal
const proposalIdBuf = Buffer.alloc(8);
proposalIdBuf.writeBigUInt64LE(BigInt(proposalId));
const [proposalPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pause-proposal"), configPda.toBuffer(), proposalIdBuf],
  SSS_PROGRAM_ID,
);
```

---

## End-to-End Runbook: 2-of-3 Emergency Pause

```
Step 1 — Setup (authority, one-time)
  init_guardian_config(guardians=[G1,G2,G3], threshold=2)

Step 2 — Incident detected by G1
  guardian_propose_pause(reason=b"oracle-price-anomaly")
  → proposal_id=0, votes=[G1], 1/2 votes

Step 3 — G2 confirms independently
  guardian_vote_pause(proposal_id=0)
  → votes=[G1,G2], 2/2 ✓ threshold reached
  → config.paused = true (auto-execute)

Step 4 — Incident resolved; authority lifts
  guardian_lift_pause()  # authority fast path
  → config.paused = false, pending_lift_votes cleared
```

---

## Security Notes

- Guardians cannot lift a pause unilaterally — full quorum of **all** guardians
  is required via the guardian path; otherwise only the authority can lift.
- Duplicate votes, non-guardian calls, and already-executed proposals are all
  rejected with distinct error codes.
- `GuardianConfig` is initialized once (`init` constraint) — the guardian set
  cannot be changed after deployment. To rotate guardians, deploy a new
  `StablecoinConfig` or add a future `update_guardian_config` instruction.
- Guardians incur a small SOL cost when opening proposals (PDA rent). Ensure
  guardian wallets are funded.
- The `reason` field is stored on-chain and emitted in events — useful for
  incident post-mortems and audit logs.

---

## Error Reference

| Error | Code | Cause |
|---|---|---|
| `NotAGuardian` | — | Signer is not in `guardian_config.guardians` |
| `GuardianListEmpty` | — | Tried to init with 0 guardians |
| `GuardianListFull` | — | More than 7 guardians supplied |
| `DuplicateGuardian` | — | Duplicate pubkey in guardian list |
| `InvalidGuardianThreshold` | — | `threshold < 1` or `threshold > guardians.len()` |
| `AlreadyVoted` | — | Guardian already voted on this proposal |
| `ProposalAlreadyExecuted` | — | Proposal threshold already met |
| `ProposalActionMismatch` | — | `proposal_id` arg doesn't match PDA |
