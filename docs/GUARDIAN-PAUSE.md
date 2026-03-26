# SSS Guardian Multisig Emergency Pause

Introduced in **SSS-121**. Allows a registered set of guardian keys to pause
a stablecoin mint without authority involvement, using an on-chain multisig
vote.

**BUG-018 / AUDIT-A HIGH-07 fix (2026-03-26):** A guardian-initiated pause
now enforces a **24-hour timelock** before the config authority can override
it unilaterally.  This prevents a compromised authority key from bypassing a
guardian emergency pause in the same block as the compromise.

---

## Overview

The guardian system adds two PDAs to each stablecoin deployment:

| PDA | Seeds | Purpose |
|---|---|---|
| `GuardianConfig` | `["guardian-config", config_pubkey]` | Stores guardian pubkeys, threshold, timelock state, and pending lift-votes |
| `PauseProposal` | `["pause-proposal", config_pubkey, proposal_id_le_bytes]` | Accumulates YES votes for a single pause request |

**Guardrails:** Guardians can only pause/unpause.  They cannot mint, burn,
change fees, alter collateral config, or do anything else to the protocol.

---

## `GuardianConfig` State

| Field | Type | Description |
|---|---|---|
| `config` | `Pubkey` | The `StablecoinConfig` this guardian set governs |
| `guardians` | `Vec<Pubkey>` | Registered guardian pubkeys (1–7) |
| `threshold` | `u8` | Minimum votes required to execute a pause proposal |
| `next_proposal_id` | `u64` | Auto-incrementing ID for the next `PauseProposal` |
| `pending_lift_votes` | `Vec<Pubkey>` | Guardians who have voted to lift the current pause |
| `guardian_pause_active` | `bool` | **BUG-018**: `true` when a guardian-quorum pause is active |
| `guardian_pause_unlocks_at` | `i64` | **BUG-018**: Unix timestamp after which authority may override; `0` when inactive |
| `bump` | `u8` | PDA bump |

**Constant:** `GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY = 86_400` seconds (24 hours)

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
applies immediately (and the BUG-018 timelock is set immediately).

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
pause is applied, the proposal is marked `executed`, and the BUG-018 timelock
is set on `GuardianConfig`.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `guardian` | ✓ | ✓ | Registered guardian voting |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint |
| `guardian_config` | ✓ | — | `GuardianConfig` PDA (updated on quorum) |
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

**BUG-018 fix — who can call:**

| Caller | Condition | Result |
|---|---|---|
| Any registered guardian | Accumulates votes in `pending_lift_votes` | Pause lifted when **all** guardians have voted (full quorum) |
| Config `authority` | `guardian_pause_active == false` | Lifts immediately (e.g. for authority-initiated pauses) |
| Config `authority` | `guardian_pause_active == true` AND `now < guardian_pause_unlocks_at` | **REJECTED** — `GuardianPauseTimelockActive` error |
| Config `authority` | `guardian_pause_active == true` AND `now >= guardian_pause_unlocks_at` | Allowed; emits `GuardianPauseAuthorityOverride` event |

> **Pre-BUG-018 behaviour (incorrect):** Authority could lift a guardian pause
> instantly at any time.  This was exploitable by a compromised authority key.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `caller` | — | ✓ | Authority or a guardian |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint |
| `guardian_config` | ✓ | — | `GuardianConfig` PDA (accumulates lift votes / clears timelock) |

```typescript
// Authority fast path (only valid after 24h timelock expires, or if pause was not guardian-initiated)
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
| `GuardianPauseAuthorityOverride` | **BUG-018**: Authority lifted a guardian pause after the 24h timelock expired; includes `authority` pubkey and `timestamp` |

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

## End-to-End Runbook: 2-of-3 Emergency Pause (BUG-018 flow)

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
  → guardian_pause_active = true
  → guardian_pause_unlocks_at = now + 86400

Step 4a — Incident resolved quickly by full guardian quorum (< 24h)
  G1, G2, G3 each call guardian_lift_pause()
  → When all 3 have called: config.paused = false, timelock cleared

Step 4b — Incident resolved by authority after 24h timelock
  (Wait until now >= guardian_pause_unlocks_at)
  guardian_lift_pause()  # authority path
  → config.paused = false, emits GuardianPauseAuthorityOverride event

Step 4c — Authority tries to override before 24h (REJECTED)
  guardian_lift_pause()  # authority path, too early
  → Error: GuardianPauseTimelockActive
```

---

## Security Notes

- **BUG-018 / AUDIT-A HIGH-07**: A guardian-quorum pause enforces a 24-hour
  timelock (`GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY = 86_400s`) before the
  authority can override it.  This prevents a single compromised authority key
  from silently unpausing in the same transaction as the compromise.
- Guardians cannot lift a pause unilaterally — full quorum of **all** guardians
  is required via the guardian path.
- Duplicate votes, non-guardian calls, and already-executed proposals are all
  rejected with distinct error codes.
- `GuardianConfig` is initialized once (`init` constraint) — the guardian set
  cannot be changed after deployment. To rotate guardians, deploy a new
  `StablecoinConfig` or add a future `update_guardian_config` instruction.
- Guardians incur a small SOL cost when opening proposals (PDA rent). Ensure
  guardian wallets are funded.
- The `reason` field is stored on-chain and emitted in events — useful for
  incident post-mortems and audit logs.
- When the authority overrides an expired guardian pause, `GuardianPauseAuthorityOverride`
  is emitted (distinct from `GuardianPauseLifted`) to aid monitoring and audit.

---

## Error Reference

| Error | Cause |
|---|---|
| `NotAGuardian` | Signer is not in `guardian_config.guardians` |
| `GuardianListEmpty` | Tried to init with 0 guardians |
| `GuardianListFull` | More than 7 guardians supplied |
| `DuplicateGuardian` | Duplicate pubkey in guardian list |
| `InvalidGuardianThreshold` | `threshold < 1` or `threshold > guardians.len()` |
| `AlreadyVoted` | Guardian already voted on this proposal or lift |
| `ProposalAlreadyExecuted` | Proposal threshold already met |
| `ProposalActionMismatch` | `proposal_id` arg doesn't match PDA |
| `GuardianPauseTimelockActive` | **BUG-018**: Authority tried to lift a guardian pause before the 24h timelock expired |
