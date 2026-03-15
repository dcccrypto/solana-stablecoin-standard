# SSS — DaoCommitteeModule Reference

> **SDK class:** `DaoCommitteeModule` (`sdk/src/DaoCommitteeModule.ts`)
> **Feature flag:** `FLAG_DAO_COMMITTEE` (bit 2, `0x04`)
> **Added:** SSS-067 (Anchor) / SSS-068 (SDK) | **Docs:** SSS-071

---

## Overview

The DAO Committee governance system provides multi-party approval for sensitive
admin operations on a stablecoin mint.  When `FLAG_DAO_COMMITTEE` is set in
`StablecoinConfig.feature_flags`, the following instructions require an
on-chain proposal that has passed quorum before they can execute:

- `pause` / `unpause`
- `set_feature_flag` / `clear_feature_flag`
- `update_minter` / `revoke_minter`

The governance lifecycle is:

1. **Admin** calls `initDaoCommittee` — creates the `DaoCommitteeConfig` PDA, registers members, sets quorum, and atomically enables `FLAG_DAO_COMMITTEE`.
2. **Any committee member** calls `proposeAction` — creates a `ProposalPda` for the desired governance action.
3. **Each committee member** calls `voteAction` — casts a yes-vote.
4. **Anyone** calls `executeAction` once quorum is reached — applies the action on-chain.

---

## Flag Constant

```typescript
export const FLAG_DAO_COMMITTEE = 1n << 2n; // 0x04
```

```rust
pub const FLAG_DAO_COMMITTEE: u64 = 1 << 2; // 0x04
```

Bit 2 of `StablecoinConfig.feature_flags`.  Enabled atomically by
`init_dao_committee`; cannot be cleared via `clear_feature_flag` alone.

---

## Import

```typescript
import {
  DaoCommitteeModule,
  FLAG_DAO_COMMITTEE,
  ProposalActionKind,
  ProposalAccount,
} from '@sss/sdk';
// or
import {
  DaoCommitteeModule,
  FLAG_DAO_COMMITTEE,
} from '@stbr/sss-token';
```

---

## Instantiation

```typescript
import { AnchorProvider } from '@coral-xyz/anchor';
import { DaoCommitteeModule } from '@sss/sdk';

const dao = new DaoCommitteeModule(provider, programId);
```

| Parameter | Type | Description |
|---|---|---|
| `provider` | `AnchorProvider` | Anchor provider; wallet must have appropriate authority for write calls. |
| `programId` | `PublicKey` | Deployed SSS token program ID. |

---

## PDA Helpers

### `getConfigPda(mint)`

Derive the `StablecoinConfig` PDA for the given mint.

```typescript
const [configPda, bump] = dao.getConfigPda(mint);
```

Seeds: `["stablecoin-config", mint]` on `programId`.

**Returns:** `[PublicKey, number]`

---

### `getCommitteePda(mint)`

Derive the `DaoCommitteeConfig` PDA for the given mint.

```typescript
const [committeePda, bump] = dao.getCommitteePda(mint);
```

Seeds: `["dao-committee", config_pubkey]` on `programId`.

**Returns:** `[PublicKey, number]`

---

### `getProposalPda(mint, proposalId)`

Derive the `ProposalPda` for a specific proposal.

```typescript
const [proposalPda, bump] = dao.getProposalPda(mint, 0);
```

Seeds: `["dao-proposal", config_pubkey, proposal_id (u32 LE)]` on `programId`.

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `proposalId` | `number` | 0-indexed proposal id. |

**Returns:** `[PublicKey, number]`

---

## Methods

### `initDaoCommittee(params)`

Initialise the DAO Committee for a stablecoin mint.  Creates the
`DaoCommitteeConfig` PDA and atomically enables `FLAG_DAO_COMMITTEE`.

```typescript
await dao.initDaoCommittee({
  mint,
  members: [alice, bob, carol],
  quorum: 2,  // 2-of-3
});
```

The wallet in `provider` must be the **admin authority** of the
`StablecoinConfig`.

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `members` | `PublicKey[]` | Committee member pubkeys (1–10). |
| `quorum` | `number` | Minimum yes-votes required (1 ≤ quorum ≤ members.length). |

**Returns:** `Promise<TransactionSignature>`

**Errors:**
- `SssError::InvalidQuorum` — quorum < 1 or > members.length.
- `SssError::CommitteeFull` — more than 10 members provided.
- `SssError::Unauthorized` — signer is not the admin authority.

---

### `proposeAction(params)`

Open a new governance proposal.  The wallet must be a registered committee member.

```typescript
// Propose pausing the mint
await dao.proposeAction({
  mint,
  proposalId: 0,
  action: { kind: 'Pause' },
});

// Propose revoking a minter
await dao.proposeAction({
  mint,
  proposalId: 1,
  action: { kind: 'RevokeMinter', minter: badActorKey },
});
```

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `proposalId` | `number` | Must match `DaoCommitteeConfig.next_proposal_id` on-chain. |
| `action` | `ProposalActionKind` | The governance action to propose (see [Action Kinds](#action-kinds)). |

**Returns:** `Promise<TransactionSignature>`

**Errors:**
- `SssError::NotACommitteeMember` — wallet is not a registered member.
- `SssError::DaoCommitteeRequired` — `FLAG_DAO_COMMITTEE` not set.

---

### `voteAction(params)`

Cast a yes-vote on an existing proposal.  Each committee member may vote once.

```typescript
// alice votes
await dao.voteAction({ mint, proposalId: 0 });
// bob votes (reaches quorum)
await dao.voteAction({ mint, proposalId: 0 });
```

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `proposalId` | `number` | The proposal id to vote on. |

**Returns:** `Promise<TransactionSignature>`

**Errors:**
- `SssError::NotACommitteeMember` — wallet is not a registered member.
- `SssError::AlreadyVoted` — this member already voted on this proposal.
- `SssError::ProposalAlreadyExecuted` — proposal was already executed.
- `SssError::ProposalCancelled` — proposal was cancelled.

---

### `executeAction(params)`

Execute a proposal once quorum is satisfied.  Anyone may call this.

```typescript
await dao.executeAction({ mint, proposalId: 0 });
```

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `proposalId` | `number` | The proposal id to execute. |

**Returns:** `Promise<TransactionSignature>`

**Errors:**
- `SssError::QuorumNotReached` — not enough yes-votes collected yet.
- `SssError::ProposalAlreadyExecuted` — already executed.
- `SssError::ProposalCancelled` — proposal was cancelled.

---

### `fetchProposal(mint, proposalId)`

Read and decode a `ProposalPda` account from on-chain.  Returns `null` if the
account does not exist.

```typescript
const proposal = await dao.fetchProposal(mint, 0);
if (proposal) {
  console.log('Action:', proposal.action);
  console.log('Votes:', proposal.votes.map(k => k.toBase58()));
  console.log('Executed:', proposal.executed);
}
```

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `proposalId` | `number` | The proposal id to fetch. |

**Returns:** `Promise<ProposalAccount | null>`

#### `ProposalAccount` shape

```typescript
interface ProposalAccount {
  config: PublicKey;
  proposalId: number;
  proposer: PublicKey;
  action: ProposalActionKind;
  votes: PublicKey[];
  executed: boolean;
  cancelled: boolean;
}
```

---

## Action Kinds

`ProposalActionKind` is a discriminated union that maps to the `ProposalAction`
enum in the Anchor program.

| `kind` | Extra fields | Anchor variant | Description |
|---|---|---|---|
| `'Pause'` | — | `Pause` | Pause the mint (`config.paused = true`). |
| `'Unpause'` | — | `Unpause` | Unpause the mint (`config.paused = false`). |
| `'SetFeatureFlag'` | `flag: bigint` | `SetFeatureFlag` | OR flag bits into `feature_flags`. |
| `'ClearFeatureFlag'` | `flag: bigint` | `ClearFeatureFlag` | AND-NOT flag bits out of `feature_flags`. |
| `'UpdateMinter'` | `newMinter: PublicKey` | `UpdateMinter` | Update the minter's cap via `update_minter`. |
| `'RevokeMinter'` | `minter: PublicKey` | `RevokeMinter` | Revoke a minter via `revoke_minter`. |

### TypeScript examples

```typescript
// Pause
{ kind: 'Pause' }

// Set circuit breaker flag
{ kind: 'SetFeatureFlag', flag: FLAG_CIRCUIT_BREAKER }

// Clear spend-policy flag
{ kind: 'ClearFeatureFlag', flag: FLAG_SPEND_POLICY }

// Revoke a minter
{ kind: 'RevokeMinter', minter: badActorKey }
```

---

## Error Reference

| Error | Description |
|---|---|
| `SssError::DaoCommitteeRequired` | Admin operation attempted without a passed proposal while `FLAG_DAO_COMMITTEE` is set. |
| `SssError::NotACommitteeMember` | The signer is not in `DaoCommitteeConfig.members`. |
| `SssError::AlreadyVoted` | Committee member already cast a yes-vote on this proposal. |
| `SssError::ProposalAlreadyExecuted` | Proposal was already executed (one-shot). |
| `SssError::ProposalCancelled` | Proposal was cancelled and can no longer be voted on or executed. |
| `SssError::QuorumNotReached` | `execute_action` called before required yes-votes collected. |
| `SssError::InvalidQuorum` | `quorum` < 1 or > `members.len()`. |
| `SssError::CommitteeFull` | Member list exceeds maximum of 10. |

---

## On-Chain Account Layout

### `DaoCommitteeConfig` PDA

Seeds: `["dao-committee", config_pubkey]`

| Field | Type | Description |
|---|---|---|
| `config` | `Pubkey` | The stablecoin config this committee governs. |
| `members` | `Vec<Pubkey>` (max 10) | Registered committee member pubkeys. |
| `quorum` | `u8` | Minimum YES votes required to pass a proposal. |
| `next_proposal_id` | `u64` | Auto-incremented proposal counter. |

### `ProposalPda` PDA

Seeds: `["dao-proposal", config_pubkey, proposal_id (u32 LE)]`

| Field | Type | Description |
|---|---|---|
| `config` | `Pubkey` | The stablecoin config being governed. |
| `proposal_id` | `u32` | Monotonically increasing index (0-based). |
| `proposer` | `Pubkey` | Authority that opened the proposal. |
| `action` | `ProposalAction` | Action to execute on quorum. |
| `param` | `u64` | Flag bits or minter cap (`0` if unused). |
| `target` | `Pubkey` | Minter key for `UpdateMinter`/`RevokeMinter`; `PublicKey::default()` otherwise. |
| `votes` | `Vec<Pubkey>` (max 10) | Committee members who have voted YES. |
| `quorum` | `u8` | Snapshot of required quorum at proposal creation time. |
| `executed` | `bool` | `true` once `execute_action` has been called successfully. |
| `cancelled` | `bool` | `true` if the proposal was cancelled. |

---

## Quorum Threshold

A proposal passes when `votes.len() >= quorum` where `quorum` is the snapshot
stored on the `ProposalPda` at creation time.  This means changes to the
`DaoCommitteeConfig.quorum` (via a separate governance proposal) do not
retroactively affect in-flight proposals.

---

## End-to-End TypeScript Example

```typescript
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  DaoCommitteeModule,
  FLAG_DAO_COMMITTEE,
  FLAG_CIRCUIT_BREAKER,
} from '@sss/sdk';

// ── Setup ────────────────────────────────────────────────────────────────────

const provider = AnchorProvider.env();
const programId = new PublicKey('<PROGRAM_ID>');
const mint      = new PublicKey('<MINT_ADDRESS>');

const dao = new DaoCommitteeModule(provider, programId);

// Committee members (their wallets sign `voteAction`)
const alice = new PublicKey('<ALICE_PUBKEY>');
const bob   = new PublicKey('<BOB_PUBKEY>');
const carol = new PublicKey('<CAROL_PUBKEY>');

// ── 1. Initialise committee (admin wallet) ───────────────────────────────────

await dao.initDaoCommittee({
  mint,
  members: [alice, bob, carol],
  quorum: 2, // 2-of-3
});

// FLAG_DAO_COMMITTEE is now set in StablecoinConfig.feature_flags

// ── 2. Propose activating the circuit breaker ────────────────────────────────

// `proposeAction` must be called by a committee member
// Switch provider wallet to alice before calling:
const daoAsAlice = new DaoCommitteeModule(aliceProvider, programId);

await daoAsAlice.proposeAction({
  mint,
  proposalId: 0, // first proposal
  action: { kind: 'SetFeatureFlag', flag: FLAG_CIRCUIT_BREAKER },
});

// ── 3. Committee members vote ────────────────────────────────────────────────

await daoAsAlice.voteAction({ mint, proposalId: 0 }); // alice votes

const daoAsBob = new DaoCommitteeModule(bobProvider, programId);
await daoAsBob.voteAction({ mint, proposalId: 0 });   // bob votes → quorum reached

// ── 4. Execute (anyone can call once quorum is met) ──────────────────────────

await dao.executeAction({ mint, proposalId: 0 });

// FLAG_CIRCUIT_BREAKER is now set; all mintTo/burnFrom calls will be rejected.

// ── 5. Inspect proposal state ────────────────────────────────────────────────

const proposal = await dao.fetchProposal(mint, 0);
console.log('Executed:', proposal?.executed);       // true
console.log('Votes:', proposal?.votes.length);      // 2

// ── 6. Fetch committee config directly via Anchor ────────────────────────────

const idl = require('./idl/sss_token.json');
const program = new Program(idl, provider);
const [committeePda] = dao.getCommitteePda(mint);

const committee = await program.account.daoCommitteeConfig.fetch(committeePda);
console.log('Next proposal ID:', committee.nextProposalId.toNumber());
console.log('Quorum:', committee.quorum);
```

---

## Related Docs

- [feature-flags.md](./feature-flags.md) — full flag constants table, DAO overview section
- [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) — pause/unpause, minter management, authority transfer
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — mintTo, burnFrom, freeze/thaw
- [SSS-3.md](./SSS-3.md) — protocol specification
