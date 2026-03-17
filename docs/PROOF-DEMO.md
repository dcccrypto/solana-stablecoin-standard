# Proof — Agent-to-Agent Task Payment Demo

> **SSS-112** · [scripts/proof-demo.ts](../scripts/proof-demo.ts)

## What Is This?

`Proof` is a runnable reference demo that shows two autonomous agents paying each other for verified work — on-chain, on Solana devnet, with no intermediary, no escrow agent, and no trust required between the parties.

It demonstrates the **Agent Payment Channel (APC)** and **Probabilistic Balance Standard (PBS)** primitives working together end-to-end.

---

## Who Are the Agents?

| Agent | Role | Description |
|-------|------|-------------|
| **Agent A** | Hirer | Posts a task ("Summarize this document") and locks 10 USDC in a PBS vault conditioned on verified output. |
| **Agent B** | Worker | Accepts the task, opens an APC with Agent A, does the work, submits a hash proof, and receives the funds. |

---

## The Flow (7 Steps)

```
Agent A                         PBS Vault                       Agent B
  │                                 │                               │
  │── commitProbabilistic ─────────▶│  Lock 10 USDC                │
  │   (taskHash, claimant=B)        │  conditionHash=sha256(task)  │
  │                                 │                               │
  │                                 │   ◀── openChannel ───────────│
  │                                 │       (APC: A↔B, 0 deposit)  │
  │                                 │                               │
  │                                 │   ◀── [Agent B does work] ───│
  │                                 │       sha256("summary...")    │
  │                                 │                               │
  │                                 │   ◀── submitWorkProof ────────│
  │                                 │       (taskHash, outputHash)  │
  │                                 │                               │
  │── verify outputHash ────────────────────────────────────────────│
  │   (expected == received?)                                        │
  │                                 │                               │
  │── proveAndResolve ─────────────▶│  Release 10 USDC → Agent B  │
  │   (proofHash = outputHash)      │                               │
  │                                 │                               │
  │◀──────────────── proposeSettle ─────────────────────────────────│
  │── countersignSettle ─────────────────────────────────────────── │
  │                                 │   APC settled                 │
```

### Step-by-Step

**Step 1 — Agent A: `commitProbabilistic`**
Agent A locks 10 USDC in a PBS vault PDA. The vault is parameterized with:
- `conditionHash = sha256("Summarize this document")` — the proof hash the worker must match
- `claimant = Agent B` — only Agent B may claim the funds
- `expirySlot = currentSlot + 1000` — Agent A gets a refund if unclaimed by then

**Step 2 — Agent B: `openChannel`**
Agent B opens a zero-deposit APC between themselves and Agent A. `DisputePolicy.TimeoutFallback` is chosen, meaning if Agent A fails to countersign settlement within 500 slots, Agent B can force-close.

**Step 3 — Agent B: do work**
Agent B performs the task (in the demo: `sha256("The document covers SSS token architecture...")`). This is entirely off-chain.

**Step 4 — Agent B: `submitWorkProof`**
Agent B writes the `taskHash` and `outputHash` on-chain via the APC. This creates a tamper-proof, timestamped record that Agent B completed the task.

**Step 5 — Agent A: verify**
Agent A checks that `received outputHash == sha256(expected output)`. In the demo this always passes. In production, Agent A would have agreed the expected output hash before task start (e.g. via a commitment scheme).

**Step 6 — Agent A: `proveAndResolve`**
Agent A submits the proof hash to the PBS vault. The vault validates `proofHash == conditionHash` and releases 10 USDC to Agent B's token account. The vault transitions to `Resolved`.

**Step 7 — Settle APC**
Agent B proposes settlement (`proposeSettle`, amount = 0 since payment came via PBS). Agent A countersigns. The APC transitions to `Settled`.

---

## Why Does This Matter?

### The Problem with Traditional Agent Payments

Traditional AI agent payment systems require one of:
- A trusted escrow service (single point of failure, fee, latency)
- Pre-payment (Agent A takes risk)
- Post-payment (Agent B takes risk)
- A centralized platform (censorship, lock-in)

### What SSS Gives You

**PBS (Probabilistic Balance Standard)** lets you lock funds in a smart-contract vault that releases on proof. The vault is a PDA on Solana — no external custodian. The condition hash is agreed before work starts. Verification is pure math.

**APC (Agent Payment Channel)** gives you a bilateral channel between two agents for submitting work proofs, logging interactions, and co-signing settlements. It's the communication layer that links task submission to payment release.

Together:

| Property | How it works |
|----------|-------------|
| **No trust between agents** | PBS vault only releases if the correct proof hash is submitted |
| **No intermediary** | All state lives in PDAs owned by the program |
| **Atomic** | `proveAndResolve` is a single transaction — proof validates and funds move in one step |
| **Auditable** | Every step is a signed, indexed, permanent Solana transaction |
| **Dispute-aware** | APC's `DisputePolicy` options provide escalation paths |
| **Composable** | Any SSS stablecoin mint can be used; the protocol is mint-agnostic |

---

## Running the Demo

### Simulation mode (no devnet required)

```bash
npx ts-node --project sdk/tsconfig.json scripts/proof-demo.ts
```

Without `SSS_PROGRAM_ID` and `USDC_MINT` set, the demo runs in **simulation mode** — it prints every step with simulated transaction signatures and final balances.

### Live devnet mode

```bash
export AGENT_A_KEYPAIR=~/.config/solana/agent-a.json
export AGENT_B_KEYPAIR=~/.config/solana/agent-b.json
export USDC_MINT=<deployed-sss-mint>
export SSS_PROGRAM_ID=<deployed-sss-program>
export DEVNET_RPC=https://api.devnet.solana.com

npx ts-node --project sdk/tsconfig.json scripts/proof-demo.ts
```

Requirements:
- Both agent wallets must have SOL for transaction fees
- Agent A's token account must have ≥ 10 USDC
- `FLAG_PROBABILISTIC_MONEY` (bit 6) must be set on the `StablecoinConfig` PDA
- `SSS-109` (PBS on-chain) and `SSS-110` (APC on-chain) must be deployed

---

## Output Example

```
────────────────────────────────────────────────────────────
  SSS Proof Demo — Agent-to-Agent Task Payment
────────────────────────────────────────────────────────────

  Agent A (Hirer):  7xKXtg2...
  Agent B (Worker): 4mNAbo1...

────────────────────────────────────────────────────────────
  Step 1 — Agent A: commitProbabilistic (10 USDC → PBS vault)
────────────────────────────────────────────────────────────

  ✓ Committed 10.000000 USDC to PBS vault
  Commitment ID: 1710717234521
  Tx: https://solscan.io/tx/<sig>?cluster=devnet

...

────────────────────────────────────────────────────────────
  Done
────────────────────────────────────────────────────────────

  ✅ Agent B received 10 USDC for verified work.
     No intermediary. No escrow agent. No trust required.
```

---

## SDK Modules Used

| Module | Source |
|--------|--------|
| `ProbabilisticModule` | [`sdk/src/ProbabilisticModule.ts`](../sdk/src/ProbabilisticModule.ts) |
| `AgentPaymentChannelModule` | [`sdk/src/AgentPaymentChannelModule.ts`](../sdk/src/AgentPaymentChannelModule.ts) |

---

## Related

- [SSS-109: PBS on-chain program](../programs/sss-token/src/instructions/pbs.rs)
- [SSS-110: APC on-chain program](../programs/sss-token/src/instructions/)
- [SSS-111: PBS + APC SDK modules](on-chain-sdk-pbs-apc.md)
- [Feature flags reference](feature-flags.md)
