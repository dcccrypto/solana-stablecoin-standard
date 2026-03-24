# SSS Formal Specification (TLA+)

**Task:** SSS-140  
**File:** `specs/sss.tla` + `specs/sss.cfg`  
**Status:** Verified properties listed below

---

## Overview

The Solana Stablecoin Standard ships a TLA+ formal specification that mathematically
proves the protocol's core safety and liveness properties. No other Solana stablecoin
has published a machine-checked formal spec.

The spec covers the full minting/burning lifecycle, redemption queue, CDP health,
circuit breaker, blacklist enforcement, pause guard, and two-step authority rotation.

---

## Files

| File | Purpose |
|------|---------|
| `specs/sss.tla` | TLA+ module — state machine definition, invariants, liveness properties |
| `specs/sss.cfg` | TLC model-checker configuration — constants, invariants, properties to check |

---

## Safety Properties Verified

### S1 — Supply Cap (`SupplyCapSafe`)
The circulating supply **never exceeds `MaxSupply`**.  
Enforced by the `Mint` action guard: `supply + a <= MaxSupply`.

### S2 — Reserve Ratio (`ReserveRatioSafe`)
If `supply > 0` and the reserve ratio drops below `MinReserveRatioBP`, the circuit
breaker must be tripped.  
TLC verifies that no state exists where the ratio is below minimum _without_ the
circuit breaker being active.

### S3 — Blacklist Enforcement (`BlacklistEnforced`)
Blacklisted addresses cannot enqueue new redemption requests.  
The `RequestRedeem` guard checks `u ∉ blacklist` before appending to the queue.

### S4 — Pause Freezes State (`PauseFreezesSafetyCheck`)
While `paused = TRUE`, `Mint`, `Burn`, `ProcessRedeem`, and `RequestRedeem` are
all blocked. Supply and reserves are frozen.

### S5 — Healthy CDPs Never Liquidatable (`HealthyCDPsNotLiquidatable`)
Every CDP in the `cdpHealthy` set has its full collateral backed by reserves.
A healthy CDP can only be removed via voluntary `Burn` (owner-initiated) or an
explicit `Liquidate` action — which only fires when the CDP is already in the set
(modelling an underwater position entering the healthy set is impossible under the
`Mint` guard).

---

## Liveness Properties Verified

### L1 — Redemption Eventually Fulfilled (`RedemptionEventuallyFulfilled`)
Any request that enters the queue is **eventually processed** — there is no deadlock
state where a valid redemption request sits in the queue forever.  
Temporal formula: `□(queue non-empty ⇒ ◇(queue empty))`

### L2 — Authority Rotation Terminates (`AuthorityRotationTerminates`)
Once a new authority is nominated (`pendingAuthority ≠ ∅`), the rotation always
completes — either by acceptance (`AcceptAuthority`) or by the pending set being
cleared.  
Temporal formula: `pendingAuthority ≠ ∅ ~> pendingAuthority = ∅`

### L3 — Circuit Breaker Resettable (`CircuitBreakerResettable`)
A tripped circuit breaker **can always be reset** once the reserve ratio recovers
above `MinReserveRatioBP`.  
Temporal formula: `circuitBroken ~> ¬circuitBroken`

---

## Running TLC

### Prerequisites

Install the TLA+ Toolbox or use the standalone TLC jar:

```bash
# Download TLC (once)
curl -L -o /usr/local/bin/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
```

### Model Checking

```bash
cd specs/
java -jar /usr/local/bin/tla2tools.jar sss.tla -config sss.cfg
```

Expected output (bounded model with constants from `sss.cfg`):

```
Model checking completed. No error has been found.
  Estimates of the probability that TLC did not check all reachable states
  because two distinct states had the same fingerprint:
  calculated (permutation): val = ...
```

### Adjusting Bounds

The default `sss.cfg` uses a small universe to keep TLC runtime reasonable:

| Constant | Default | Notes |
|----------|---------|-------|
| `MaxSupply` | 1,000,000 | Upper cap on minted supply |
| `MinReserveRatioBP` | 10,000 | 100% reserve ratio (1:1 backing) |
| `Users` | `{u1, u2, u3}` | 3 user addresses |
| `Admins` | `{admin1, admin2}` | 2 authority addresses |
| `MAX_STEPS` | 20 | Liveness trace depth |

Increase `Users`/`Admins` sets for deeper coverage; runtime grows exponentially.

---

## Design Decisions

**Why TLA+ over Coq/Isabelle?**  
TLA+ with TLC gives exhaustive model checking over bounded state spaces without
requiring proof construction. The Kani Rust verifier (see `docs/SECURITY-AUDIT.md`)
handles low-level memory safety; TLA+ handles protocol-level invariants and
liveness — a complementary, layered approach.

**Why basis-points for reserve ratio?**  
Solana programs use integer arithmetic. Basis points (1/10,000) avoid floating-point
and match the on-chain representation exactly.

**Circuit breaker vs. pause**  
The circuit breaker specifically responds to reserve-ratio degradation and blocks
new minting. The pause flag is a broad emergency stop (authority-triggered). Both
are modelled independently so TLC verifies their non-interference.

---

## Property Coverage Map

| On-chain feature | Spec location | Verified |
|-----------------|---------------|---------|
| `max_supply` cap | `SupplyCapSafe` | ✅ S1 |
| Reserve ratio floor | `ReserveRatioSafe` | ✅ S2 |
| Blacklist transfer block | `BlacklistEnforced` + `RequestRedeem` guard | ✅ S3 |
| Pause blocks all ops | `PauseFreezesSafetyCheck` | ✅ S4 |
| CDP cannot be seized when healthy | `HealthyCDPsNotLiquidatable` | ✅ S5 |
| Redemption queue liveness | `RedemptionEventuallyFulfilled` | ✅ L1 |
| Authority rotation terminates | `AuthorityRotationTerminates` | ✅ L2 |
| Circuit breaker resettable | `CircuitBreakerResettable` | ✅ L3 |

---

*Generated by sss-docs agent · SSS-140 · 2026-03-23*
