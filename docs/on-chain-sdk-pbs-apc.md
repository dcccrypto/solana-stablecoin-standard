# Probabilistic Balance Standard & Agent Payment Channel — SDK Guide

> **SSS-109 / SSS-111** | TypeScript SDK | `@sss/sdk`

Two new SDK modules ship in SSS-111: `ProbabilisticModule` (PBS — SSS-109) and `AgentPaymentChannelModule` (APC). Both target agent-to-agent micropayment use cases where full upfront trust is undesirable.

---

## ProbabilisticModule (PBS)

The Probabilistic Balance Standard lets an **issuer** lock stablecoins in a hash-conditioned escrow vault. A **claimant** (typically an AI agent completing a task) can release funds by supplying the matching proof hash.

### Prerequisites

The `FLAG_PROBABILISTIC_MONEY` feature flag (`1 << 20 = 0x100000`, bit 20) must be set on the `StablecoinConfig` PDA at initialization time. Check with `feature-flags.md`.

> **AUDIT3-B fix (2026-03-27):** The flag constant was previously documented and coded as `1 << 6 = 0x40` (bit 6), which is actually `FLAG_TRAVEL_RULE`. The correct on-chain constant in `state.rs` is bit 20. `ProbabilisticModule.ts` has been updated accordingly. `commitProbabilistic()` now performs an explicit SDK-level guard — it fetches the config and throws a clear error if `FLAG_PROBABILISTIC_MONEY` is not set, rather than allowing an opaque on-chain revert.

### Quick Start

```ts
import { ProbabilisticModule } from '@sss/sdk';
import { createHash } from 'crypto';
import { BN } from '@coral-xyz/anchor';

const pbs = new ProbabilisticModule(provider, programId);

// Issuer: hash the task condition and commit funds
const conditionHash = createHash('sha256').update('task: summarize document X').digest();
const commitmentId  = new BN(Date.now());

const { txSig } = await pbs.commitProbabilistic({
  mint,
  amount: new BN(10_000_000),   // 10 USDC (6 decimals)
  conditionHash,
  expirySlot: new BN(currentSlot + 10_000),
  claimant: agentBPubkey,
  escrowTokenAccount,           // ATA owned by vault PDA, pre-created by caller
  commitmentId,
});

// Claimant: prove task completion and receive funds
await pbs.proveAndResolve(conditionHash, {
  mint,
  commitmentId,
  escrowTokenAccount,
  claimantTokenAccount,
});
```

### Methods

| Method | Signer | Description |
|--------|--------|-------------|
| `commitProbabilistic(params)` | Issuer | Lock tokens; creates `ProbabilisticVault` PDA. Throws if `FLAG_PROBABILISTIC_MONEY` (bit 20) is not set. |
| `proveAndResolve(proofHash, params)` | Claimant | Full release on hash match |
| `partialResolve(proofHash, params)` | Claimant | Partial release; remainder to issuer |
| `expireAndRefund(params)` | Anyone | Refund issuer after `expirySlot` |
| `getCommitment(mint, commitmentId)` | — | Fetch + decode vault state |
| `remainingAmount(vault)` | — | `committedAmount - resolvedAmount` |
| `isTerminal(vault)` | — | `true` when Resolved or Expired |

### PDA Helpers

```ts
// Standalone helpers (also available as instance methods):
import { derivePbsConfigPda, derivePbsVaultPda } from '@sss/sdk';

const [configPda] = derivePbsConfigPda(mint, programId);
const [vaultPda]  = derivePbsVaultPda(configPda, commitmentId, programId);
```

Seeds:
- `StablecoinConfig`: `["stablecoin-config", mint]`
- `ProbabilisticVault`: `["pbs-vault", config, commitment_id_le8]`

### VaultStatus Lifecycle

```
Pending → Resolved          (proveAndResolve — full release)
Pending → PartiallyResolved (partialResolve)
Pending → Expired           (expireAndRefund after expirySlot)
```

Terminal states: `Resolved`, `Expired`.

### Vault Account Layout

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | StablecoinConfig PDA |
| `issuer` | `Pubkey` | Wallet that locked funds |
| `claimant` | `Pubkey` | Only wallet that may prove |
| `stableMint` | `Pubkey` | SSS stablecoin mint |
| `committedAmount` | `u64` | Total tokens in escrow |
| `resolvedAmount` | `u64` | Sum of all releases |
| `conditionHash` | `[u8;32]` | SHA-256 condition hash |
| `expirySlot` | `u64` | Slot after which refund allowed |
| `commitmentId` | `u64` | Monotonic id (caller-managed) |
| `status` | `VaultStatus` | Current lifecycle state |
| `bump` | `u8` | PDA bump seed |

---

## AgentPaymentChannelModule (APC)

The Agent Payment Channel enables **two agents** (opener/hirer and counterparty/worker) to transact trust-minimally. The opener optionally deposits stablecoins; the worker submits work proofs; settlement flows cooperatively or unilaterally via timeout.

### Prerequisites

The `FLAG_AGENT_PAYMENT_CHANNEL` feature flag (`1 << 19 = 0x00080000`, bit 19) must be set on the `StablecoinConfig` PDA. `openChannel()` performs an explicit SDK-level guard before building any transaction — it reads the config, checks the flag, and throws a descriptive error if APC is not enabled.

> **Security fix (PR #325, 2026-03-27):** `_readConfigFeatureFlags()` now throws on truncated or malformed account data (data buffer shorter than expected layout) instead of silently returning `0n`. This prevents a malformed config account from bypassing the feature-flag guard. Additionally, `openChannel()` asserts `counterparty` is a non-zero public key before proceeding.

### Quick Start

```ts
import { AgentPaymentChannelModule, DisputePolicy, ApcProofType } from '@sss/sdk';
import { createHash } from 'crypto';
import { BN } from '@coral-xyz/anchor';

const apc = new AgentPaymentChannelModule(provider, programId);

const sha256 = (s: string) =>
  createHash('sha256').update(s).digest();

// Opener: open channel (zero-deposit or pre-funded)
const { channelId } = await apc.openChannel({
  mint,
  counterparty: agentBPubkey,
  deposit: new BN(50_000_000),   // 50 USDC pre-funded
  disputePolicy: DisputePolicy.TimeoutFallback,
  timeoutSlots: new BN(500),
  channelId: new BN(Date.now()),
  escrowTokenAccount,
});

// Counterparty: submit work proof
await apc.submitWorkProof(channelId, {
  mint,
  taskHash: sha256('summarize document X'),
  outputHash: sha256(resultText),
  proofType: ApcProofType.HashProof,
});

// Either party: propose settlement
await apc.proposeSettle(channelId, {
  mint,
  amount: new BN(50_000_000),
});

// Other party: countersign to settle
await apc.countersignSettle(channelId, {
  mint,
  openerTokenAccount,
  counterpartyTokenAccount,
  escrowTokenAccount,
});
```

### Methods

| Method | Signer | Description |
|--------|--------|-------------|
| `openChannel(params)` | Opener | Create `PaymentChannel` PDA; optional deposit |
| `submitWorkProof(channelId, params)` | Counterparty | Record `taskHash` + `outputHash` on-chain |
| `proposeSettle(channelId, params)` | Either | Initiate cooperative settlement |
| `countersignSettle(channelId, params)` | Either | Countersign; executes token transfers |
| `dispute(channelId, params)` | Either | Raise dispute with `evidenceHash` |
| `forceClose(channelId, params)` | Opener | Reclaim deposit after timeout |
| `getChannel(mint, channelId)` | — | Fetch + decode channel state |
| `isForceCloseEligible(channel, currentSlot)` | — | Check timeout eligibility |
| `isTerminal(channel)` | — | `true` when Settled or ForceClosed |

### PDA Helpers

```ts
import { deriveApcConfigPda, deriveChannelPda } from '@sss/sdk';

const [configPda]  = deriveApcConfigPda(mint, programId);
const [channelPda] = deriveChannelPda(configPda, channelId, programId);
```

Seeds:
- `StablecoinConfig`: `["stablecoin-config", mint]`
- `PaymentChannel`: `["apc-channel", config, channel_id_le8]`

### DisputePolicy

| Value | Behaviour |
|-------|-----------|
| `TimeoutFallback` (0) | Opener reclaims deposit after `timeout_slots` |
| `MajorityOracle` (1) | 2-of-3 oracle committee adjudicates |
| `ArbitratorKey` (2) | Named arbitrator pubkey resolves |

### ApcProofType

| Value | Description |
|-------|-------------|
| `HashProof` (0) | SHA-256 output hash verification (default) |
| `ZkSnarkProof` (1) | ZK-SNARK proof (future) |
| `OracleAttestation` (2) | Registered oracle attests completion |

### ChannelStatus Lifecycle

```
Open → PendingSettle     (proposeSettle)
PendingSettle → Settled  (countersignSettle — cooperative)
PendingSettle → ForceClosed (forceClose after timeout)
Open/PendingSettle → Disputed (dispute)
```

Terminal states: `Settled`, `ForceClosed`.

### Channel Account Layout

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | StablecoinConfig PDA |
| `opener` | `Pubkey` | Hirer / Agent A |
| `counterparty` | `Pubkey` | Worker / Agent B |
| `stableMint` | `Pubkey` | SSS stablecoin mint |
| `deposit` | `u64` | Opener's locked deposit |
| `settleAmount` | `u64` | Agreed settlement amount |
| `disputePolicy` | `DisputePolicy` | Resolution mechanism |
| `timeoutSlots` | `u64` | Force-close window |
| `settleProposedAt` | `u64` | Slot of `proposeSettle` |
| `lastOutputHash` | `[u8;32]` | Most recent work proof output |
| `lastProofType` | `ApcProofType` | Most recent proof type |
| `channelId` | `u64` | Monotonic id (caller-managed) |
| `status` | `ChannelStatus` | Current lifecycle state |
| `openerSigned` | `bool` | Opener has signed settlement |
| `counterpartySigned` | `bool` | Counterparty has signed |
| `bump` | `u8` | PDA bump seed |

---

## PBS + APC Together

PBS and APC are complementary. A typical agent workflow:

1. **Open APC channel** (zero deposit) to establish the bilateral relationship.
2. **PBS commit** locked tokens against a task condition hash.
3. Worker **submits work proof** on APC (records `outputHash` on-chain).
4. **PBS proveAndResolve** — worker supplies matching `conditionHash` to release tokens.
5. **APC proposeSettle / countersignSettle** — close the channel.

This separates capital lock-up (PBS) from task lifecycle tracking (APC), enabling streaming micropayments across many tasks on a single channel.

---

## Exports

All types, enums, and functions are re-exported from `@sss/sdk`:

```ts
// Modules
import { ProbabilisticModule, AgentPaymentChannelModule } from '@sss/sdk';

// Enums
import { VaultStatus, ChannelStatus, DisputePolicy, ApcProofType } from '@sss/sdk';

// PDA helpers
import { derivePbsConfigPda, derivePbsVaultPda } from '@sss/sdk';
import { deriveApcConfigPda, deriveChannelPda } from '@sss/sdk';

// Constants
import { FLAG_PROBABILISTIC_MONEY, PBS_VAULT_SEED, APC_CHANNEL_SEED } from '@sss/sdk';
```
