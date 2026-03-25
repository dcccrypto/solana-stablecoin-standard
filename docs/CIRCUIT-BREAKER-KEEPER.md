# Circuit Breaker Keeper (SSS-152)

> **Introduced:** commit `10690bb` — `feat(sss-152): permissionless circuit breaker keeper — automated peg protection`

The Circuit Breaker Keeper adds two **permissionless** instructions that automate peg-deviation protection without requiring the admin authority to be online.

---

## Overview

| What | How |
|---|---|
| Trigger | `crank_circuit_breaker()` — any cranker; pauses mint when price deviates |
| Recovery | `crank_unpause()` — any caller; unpauses once price is stable |
| Incentive | SOL reward paid from the `KeeperConfig` vault on successful `crank_circuit_breaker` |
| Rate limit | `min_cooldown_slots` between successive triggers |
| Recovery gate | `sustained_recovery_slots` of continuous within-threshold price before unpause |

---

## Accounts

### `KeeperConfig` PDA

Seeds: `["keeper-config", sss_mint]`  
Space: `8 + 83` bytes

| Field | Type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | Stablecoin mint this config governs |
| `deviation_threshold_bps` | `u16` | Max tolerated deviation in basis points (e.g. `200` = 2%). Range: 1–5000 |
| `keeper_reward_lamports` | `u64` | SOL paid to the keeper on a successful trigger |
| `min_cooldown_slots` | `u64` | Minimum slots between circuit-breaker activations |
| `sustained_recovery_slots` | `u64` | Consecutive slots price must be within threshold before auto-unpause |
| `target_price` | `u64` | Expected peg price in oracle units (e.g. `1_000_000` = $1.00 at 6 decimals) |
| `last_trigger_slot` | `u64` | Slot of the last successful trigger (0 = never triggered) |
| `last_within_threshold_slot` | `u64` | First slot in the current recovery window (0 = no active recovery) |
| `bump` | `u8` | PDA bump |

---

## Instructions

### `init_keeper_config` — authority-only

Initialises the `KeeperConfig` PDA.  
When `FLAG_SQUADS_AUTHORITY` is set, the Squads multisig signer is required.

**Parameters (`InitKeeperConfigParams`):**

```rust
pub struct InitKeeperConfigParams {
    pub deviation_threshold_bps: u16,   // 1–5000
    pub keeper_reward_lamports: u64,
    pub min_cooldown_slots: u64,        // > 0
    pub sustained_recovery_slots: u64,  // > 0
    pub target_price: u64,              // > 0, in oracle units
}
```

**Emits:** `KeeperConfigInitialised { mint, deviation_threshold_bps, keeper_reward_lamports, min_cooldown_slots, sustained_recovery_slots }`

---

### `seed_keeper_vault` — permissionless

Transfers SOL lamports from any funder directly into the `KeeperConfig` PDA, topping up the reward balance.

```typescript
await program.methods
  .seedKeeperVault(new BN(1_000_000_000)) // 1 SOL
  .accounts({ funder, keeperConfig, systemProgram })
  .rpc();
```

---

### `crank_circuit_breaker` — permissionless

Reads the oracle price feed, checks peg deviation, and halts the mint if the threshold is exceeded. Pays the keeper a SOL reward on success.

**Pre-conditions (all must hold, else error):**

| Check | Error |
|---|---|
| `FLAG_CIRCUIT_BREAKER` set in `StablecoinConfig.feature_flags` | `CircuitBreakerNotArmed` |
| Cooldown window elapsed since last trigger | `KeeperCooldownActive` |
| Config not already paused | `MintPaused` |
| Oracle price deviation ≥ `deviation_threshold_bps` | `PegWithinThreshold` |

**On success:**
1. `StablecoinConfig.paused = true` — halts all mint/burn
2. `KeeperConfig.last_trigger_slot = clock.slot`
3. `KeeperConfig.last_within_threshold_slot = 0` — resets recovery window
4. SOL reward transferred from `KeeperConfig` lamports → keeper wallet (if vault has sufficient balance above rent-exempt minimum)

**Emits:**
- `CircuitBreakerTriggered { mint, keeper, oracle_price, target_price, deviation_bps, slot }`
- `KeeperRewarded { mint, keeper, reward_lamports, slot }` (if reward paid)

**Reward vault depletion:** if the vault balance minus reward would fall below rent-exempt minimum, the reward is silently skipped. The circuit breaker still triggers. Top up the vault via `seed_keeper_vault`.

---

### `crank_unpause` — permissionless

Unpauses the mint once the oracle price has remained within `deviation_threshold_bps` for `sustained_recovery_slots` consecutive slots.

**Pre-conditions:**

| Check | Error |
|---|---|
| Config is currently paused | `NotPaused` |
| Oracle price within threshold | `PegStillDeviating` |
| Recovery window satisfied | `KeeperRecoveryWindowNotMet` |

**Recovery window logic:**
- First slot within threshold → `last_within_threshold_slot = clock.slot`
- Subsequent calls while within threshold check `clock.slot - last_within_threshold_slot >= sustained_recovery_slots`
- If price goes back out of threshold → `last_within_threshold_slot = 0` (reset)

**On success:**
1. `StablecoinConfig.paused = false`
2. `KeeperConfig.last_within_threshold_slot = 0`

**Emits:** `CircuitBreakerAutoUnpaused { mint, caller, oracle_price, target_price, deviation_bps, recovery_slots, slot }`

> ⚠️ No SOL reward is paid for `crank_unpause` to prevent griefing (repeatedly calling unpause to drain the vault).

---

## Errors

| Error | When |
|---|---|
| `CircuitBreakerNotArmed` | `FLAG_CIRCUIT_BREAKER` not set in feature flags |
| `KeeperCooldownActive` | Called before `min_cooldown_slots` elapsed since last trigger |
| `PegWithinThreshold` | Price deviation < `deviation_threshold_bps` |
| `PegStillDeviating` | Price deviation ≥ threshold during unpause attempt |
| `KeeperRecoveryWindowNotMet` | Not enough slots within threshold yet |
| `NotPaused` | `crank_unpause` called when config is not paused |
| `KeeperConfigMintMismatch` | `KeeperConfig.sss_mint` ≠ `StablecoinConfig.mint` |
| `InvalidKeeperDeviation` | `deviation_threshold_bps` is 0 or > 5000 |
| `InvalidKeeperCooldown` | `min_cooldown_slots` is 0 |
| `InvalidKeeperRecovery` | `sustained_recovery_slots` is 0 |

---

## Events

```rust
// Emitted when the circuit breaker fires
CircuitBreakerTriggered {
    mint: Pubkey,
    keeper: Pubkey,
    oracle_price: i64,
    target_price: u64,
    deviation_bps: u64,
    slot: u64,
}

// Emitted when the mint auto-unpauses
CircuitBreakerAutoUnpaused {
    mint: Pubkey,
    caller: Pubkey,
    oracle_price: i64,
    target_price: u64,
    deviation_bps: u64,
    recovery_slots: u64,
    slot: u64,
}

// Emitted when keeper reward is transferred
KeeperRewarded {
    mint: Pubkey,
    keeper: Pubkey,
    reward_lamports: u64,
    slot: u64,
}

// Emitted on init_keeper_config
KeeperConfigInitialised {
    mint: Pubkey,
    deviation_threshold_bps: u16,
    keeper_reward_lamports: u64,
    min_cooldown_slots: u64,
    sustained_recovery_slots: u64,
}
```

---

## TypeScript SDK Usage

```typescript
import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

// Derive PDA
const [keeperConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from('keeper-config'), mint.toBytes()],
  programId,
);

// 1. Init (authority only)
await program.methods
  .initKeeperConfig({
    deviationThresholdBps: 200,        // 2%
    keeperRewardLamports: new BN(5_000_000),  // 0.005 SOL
    minCooldownSlots: new BN(400),     // ~2.5 min at 400ms/slot
    sustainedRecoverySlots: new BN(600),
    targetPrice: new BN(1_000_000),    // $1.00 (6 dec oracle)
  })
  .accounts({ authority, config, keeperConfig, systemProgram })
  .rpc();

// 2. Seed vault
await program.methods
  .seedKeeperVault(new BN(2_000_000_000))  // 2 SOL
  .accounts({ funder, keeperConfig, systemProgram })
  .rpc();

// 3. Crank (permissionless — run in keeper bot)
await program.methods
  .crankCircuitBreaker()
  .accounts({ keeper, config, keeperConfig, oracleFeed, systemProgram, clock })
  .rpc();

// 4. Unpause (after peg recovers)
await program.methods
  .crankUnpause()
  .accounts({ caller, config, keeperConfig, oracleFeed, clock })
  .rpc();
```

---

## Keeper Bot Runbook

### Setup

```bash
# 1. Deploy program with SSS-152 instructions
anchor build && anchor deploy

# 2. Init keeper config (admin keypair required)
sss-cli keeper init \
  --mint <MINT> \
  --deviation-bps 200 \
  --reward-lamports 5000000 \
  --cooldown-slots 400 \
  --recovery-slots 600 \
  --target-price 1000000 \
  --keypair /path/to/admin.json

# 3. Seed vault
sss-cli keeper seed-vault \
  --mint <MINT> \
  --amount-sol 2 \
  --keypair /path/to/funder.json
```

### Running the keeper

The keeper bot should poll every slot (or every N slots) and call `crank_circuit_breaker`. A minimal loop:

```typescript
while (true) {
  try {
    await program.methods.crankCircuitBreaker()
      .accounts({ ... })
      .rpc();
    console.log('Circuit breaker cranked successfully');
  } catch (e) {
    if (e.message.includes('PegWithinThreshold')) {
      // Normal — peg is healthy
    } else if (e.message.includes('KeeperCooldownActive')) {
      // Wait out cooldown
    } else {
      console.error('Unexpected error:', e);
    }
  }
  await sleep(SLOT_MS * CRANK_INTERVAL_SLOTS);
}
```

### Monitoring vault balance

Alert when `KeeperConfig` lamports approach the reward-depleted threshold:

```typescript
const accountInfo = await connection.getAccountInfo(keeperConfig);
const vaultLamports = accountInfo.lamports;
const minRent = await connection.getMinimumBalanceForRentExemption(8 + 83);
const available = vaultLamports - minRent;
if (available < keeperRewardLamports * 10n) {
  alert('Keeper vault low — top up via seed_keeper_vault');
}
```

### Recovery flow

1. Circuit breaker fires → `StablecoinConfig.paused = true`
2. Incident team investigates root cause
3. Oracle price returns within `deviation_threshold_bps`
4. Any caller runs `crank_unpause` on each subsequent slot until `sustained_recovery_slots` elapsed
5. Mint auto-unpauses

> **Manual override:** if the peg recovers but the team wants to keep the mint paused longer for investigation, the authority can call `unpause()` / `pause()` directly via `GuardianPauseModule` — the keeper instructions do not override manual authority actions.

---

## Relationship to Existing Circuit Breaker Flag

SSS-152 does **not** change the semantics of `FLAG_CIRCUIT_BREAKER` (`0x01`). The flag must still be **armed by the authority** via `set_feature_flag` before `crank_circuit_breaker` will fire. This preserves existing access control: a keeper cannot trigger the circuit breaker on a config where the authority has not opted in.

See [`feature-flags.md`](feature-flags.md) for the `FLAG_CIRCUIT_BREAKER` / `FLAG_CIRCUIT_BREAKER_V2` migration note (AUDIT-F1).

---

## Tests

`tests/sss-152-circuit-breaker-keeper.ts` — 25 tests:

| Category | Tests |
|---|---|
| Validation | non-authority init, zero deviation, deviation > 5000, zero cooldown, zero recovery |
| Happy path | `init_keeper_config`, `KeeperConfig` field assertions, `seed_keeper_vault` |
| Circuit breaker | CB not armed check, oracle routing, cooldown enforcement, paused-state check |
| Model / math | deviation BPS formula, recovery slot tracking, threshold boundary |

---

## See Also

- [`feature-flags.md`](feature-flags.md) — `FLAG_CIRCUIT_BREAKER` reference and AUDIT-F1 migration
- [`GUARDIAN-PAUSE.md`](GUARDIAN-PAUSE.md) — manual pause/unpause instructions
- [`ORACLE-ABSTRACTION.md`](ORACLE-ABSTRACTION.md) — oracle feed types and `get_oracle_price`
- [`INSURANCE-VAULT.md`](INSURANCE-VAULT.md) — first-loss vault (SSS-151)
- [`MONITORING.md`](MONITORING.md) — event-based alerting for circuit breaker events
