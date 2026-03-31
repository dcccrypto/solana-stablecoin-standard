# On-Chain SDK — GuardianModule

> **Introduced:** PR #336 — `fix/sdk-anchor-audit-fixes` (merged 2026-03-31)
> **References:** SSS-121 (guardian pause system), BUG-018 (authority override timelock)

---

## Overview

`GuardianModule` wraps the multi-sig guardian pause system.  A quorum of
guardian pubkeys must vote before a stablecoin can be paused.  BUG-018
enforcement ensures the admin authority cannot override a guardian pause
without a timelock.

| Method | Instruction | Auth |
|---|---|---|
| `initGuardianConfig` | `init_guardian_config` | stablecoin authority |
| `proposePause` | `propose_pause` | any guardian |
| `votePause` | `vote_pause` | any guardian |
| `liftPause` | `lift_pause` | stablecoin authority (timelock enforced) |
| `fetchNextProposalId` | read | — |

---

## Installation

```ts
import { GuardianModule } from '@sss/sdk';

const guardian = new GuardianModule(provider, programId);
```

---

## PDA Helpers

### `getConfigPda(mint)` → `[PublicKey, number]`
Seeds: `[b"stablecoin-config", mint]`

### `getGuardianConfigPda(mint)` → `[PublicKey, number]`
Seeds: `[b"guardian-config", mint]`

### `getProposalPda(mint, proposalId)` → `[PublicKey, number]`
Seeds: `[b"pause-proposal", mint, proposalId (u64 LE)]`

---

## Methods

### `initGuardianConfig(params)` → `Promise<TransactionSignature>`

Initialise the `GuardianConfig` PDA.  Sets guardian pubkeys and threshold.
Authority-only.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `guardians` | `PublicKey[]` | List of guardian pubkeys. |
| `threshold` | `number` | Number of votes required to pass a pause proposal. |

```ts
await guardian.initGuardianConfig({ mint, guardians: [g1, g2, g3], threshold: 2 });
```

---

### `proposePause(params)` → `Promise<TransactionSignature>`

Open a pause proposal.  Must be a registered guardian.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `proposalId` | `bigint` | Proposal ID (use `fetchNextProposalId` to obtain). |
| `reason` | `string` | Human-readable pause reason (max 64 bytes). |

```ts
const proposalId = await guardian.fetchNextProposalId(mint);
await guardian.proposePause({ mint, proposalId, reason: 'Suspected exploit' });
```

---

### `votePause(params)` → `Promise<TransactionSignature>`

Cast a vote on an open pause proposal.  When threshold is reached the
stablecoin is paused immediately on-chain.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `proposalId` | `bigint` | Proposal ID to vote on. |

```ts
await guardian.votePause({ mint, proposalId });
```

---

### `liftPause(params)` → `Promise<TransactionSignature>`

Lift an active guardian pause.  Authority-only.  BUG-018 enforcement:
the `admin_timelock_delay` must have elapsed since the pause was set before
the authority can call this.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |

```ts
await guardian.liftPause({ mint });
```

---

### `fetchNextProposalId(mint)` → `Promise<bigint | null>`

Read the `GuardianConfig` PDA and return the next available proposal ID.
Returns `null` if the PDA has not been initialised.

```ts
const id = await guardian.fetchNextProposalId(mint);
```

---

## Related

- [GUARDIAN-PAUSE.md](GUARDIAN-PAUSE.md) — guardian pause design (SSS-121)
- [on-chain-sdk-admin-timelock.md](on-chain-sdk-admin-timelock.md) — admin timelock
- BUG-018 — authority override timelock fix
