# Multi-Oracle Consensus

Introduced in **SSS-153** (`cd66124`). Provides tamper-resistant price feeds
by aggregating up to five oracle sources (Pyth, Switchboard, Custom) into a
single consensus price with outlier rejection and TWAP fallback.

---

## Overview

Single-oracle designs are vulnerable to feed manipulation, staleness, and
provider downtime. SSS-153 adds an `OracleConsensus` PDA that:

- Reads **up to 5** oracle sources (Pyth / Switchboard / Custom).
- Computes a **median consensus price** from fresh, non-outlier sources.
- **Rejects outliers** deviating more than `outlier_threshold_bps` from the median.
- **Detects staleness** per-source via slot-based `max_age_slots`.
- Falls back to an **EMA TWAP** (α = 1/8) when fewer than `min_oracles` qualify.
- Is gated by **`FLAG_MULTI_ORACLE_CONSENSUS`** (bit 22).

When the flag is set, `update_oracle_consensus` becomes the canonical price
source for CDP, circuit breaker, and any instruction that reads oracle price.

---

## PDA Layout

**Seeds:** `[b"oracle-consensus", sss_mint]`

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `min_oracles` | `u8` | Min accepted sources needed for consensus (1–5) |
| `outlier_threshold_bps` | `u16` | Max deviation from median before rejection (1–5000 bps) |
| `max_age_slots` | `u64` | Max source age in slots for freshness |
| `source_count` | `u8` | Number of configured source slots |
| `sources` | `[OracleSource; 5]` | Source entries (`oracle_type` + `feed` pubkey) |
| `last_consensus_price` | `u64` | Last computed consensus price |
| `last_consensus_slot` | `u64` | Slot of last update |
| `twap_price` | `u64` | EMA TWAP price |
| `twap_last_slot` | `u64` | Slot of last TWAP update |

**Space:** 8 (discriminator) + 242 bytes = 250 bytes.

---

## Instructions

### `init_oracle_consensus`
**Authority only.** Creates the `OracleConsensus` PDA and sets
`FLAG_MULTI_ORACLE_CONSENSUS` on the config.

```
Args:
  min_oracles           u8    — minimum accepted sources (1–5)
  outlier_threshold_bps u16   — rejection threshold in bps (1–5000)
  max_age_slots         u64   — staleness window in slots (> 0)
```

### `set_oracle_source`
**Authority only.** Adds or updates a source slot.

```
Args:
  slot_index   u8     — which slot to write (0–4)
  oracle_type  u8     — 0=Pyth, 1=Switchboard, 2=Custom
  feed_pubkey  Pubkey — the price-feed account address
```

### `remove_oracle_source`
**Authority only.** Zeros out a source slot (sets `feed = Pubkey::default()`).

```
Args:
  slot_index   u8     — which slot to clear (0–4)
```

### `update_oracle_consensus`
**Permissionless keeper crank.** Reads all configured source feeds via
`remaining_accounts` (one account per slot, in slot order — use a placeholder
for empty slots so indices line up), computes consensus price, updates TWAP,
and emits events.

```
remaining_accounts: [feed_0, feed_1, feed_2, feed_3, feed_4]
  (must match oracle_consensus.sources order; use any placeholder for empty slots)
```

---

## Consensus Algorithm

```
1. For each source with a configured feed:
   a. Validate remaining_accounts[i].key == source.feed
   b. Read price via oracle adapter (Pyth / Switchboard / Custom)
   c. If stale (current_slot - last_slot > max_age_slots) → emit OracleStalenessDetected, skip

2. Compute median of all fresh prices

3. For each fresh price, compute deviation from median in bps:
   dev_bps = |price - median| * 10_000 / median
   If dev_bps > outlier_threshold_bps → emit OracleOutlierRejected, skip

4. If accepted_count >= min_oracles:
     consensus_price = median of accepted prices   (used_twap = false)
   Else if twap_price > 0:
     consensus_price = twap_price                  (used_twap = true)
   Else:
     err InsufficientOracles

5. Update TWAP (EMA, α=1/8):
   twap = twap * 7/8 + new_price * 1/8

6. Write last_consensus_price, emit OracleConsensusUpdated
```

---

## Events

### `OracleConsensusUpdated`
| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `consensus_price` | `u64` | Final consensus price |
| `source_count` | `u8` | Number of accepted sources |
| `used_twap` | `bool` | `true` if TWAP fallback was used |
| `slot` | `u64` | Current slot |

### `OracleStalenessDetected`
| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `source_index` | `u8` | Slot index of the stale source |
| `feed` | `Pubkey` | Feed account address |
| `last_slot` | `u64` | Last update slot of the feed |
| `current_slot` | `u64` | Current slot |

### `OracleOutlierRejected`
| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint |
| `source_index` | `u8` | Slot index of the outlier source |
| `feed` | `Pubkey` | Feed account address |
| `price` | `u64` | Rejected price |
| `median` | `u64` | Median price at rejection time |
| `deviation_bps` | `u64` | Actual deviation in bps |
| `slot` | `u64` | Current slot |

---

## Errors

| Error | Condition |
|---|---|
| `MultiOracleNotEnabled` | `FLAG_MULTI_ORACLE_CONSENSUS` not set or no sources configured |
| `OracleConsensusNotFound` | `OracleConsensus` PDA not initialised |
| `InsufficientOracles` | Fewer than `min_oracles` accepted and no TWAP fallback available |
| `OraclePriceDeviation` | _(reserved; deviation is handled via event + skip)_ |
| `OracleStaleFeed` | _(reserved; staleness is handled via event + skip)_ |
| `InvalidOracleConsensusConfig` | Bad `init_oracle_consensus` args (min\_oracles, bps, or max\_age\_slots out of range) |
| `InvalidOracleSourceIndex` | `slot_index >= MAX_SOURCES` |

---

## Feature Flag

| Constant | Bit | Hex |
|---|---|---|
| `FLAG_MULTI_ORACLE_CONSENSUS` | 22 | `0x400000` |

Set automatically by `init_oracle_consensus`. To disable, use the standard
`toggle_feature_flag` instruction (authority only). When unset,
`update_oracle_consensus` returns `MultiOracleNotEnabled`.

---

## Setup Runbook

```bash
# 1. Initialise consensus PDA (min 3 oracles, 2% outlier threshold, 150 slot staleness window)
anchor run init-oracle-consensus -- \
  --mint <SSS_MINT> \
  --min-oracles 3 \
  --outlier-threshold-bps 200 \
  --max-age-slots 150

# 2. Register Pyth SOL/USD feed in slot 0
anchor run set-oracle-source -- --mint <SSS_MINT> --slot 0 --type pyth \
  --feed <PYTH_SOL_USD_FEED>

# 3. Register Switchboard SOL/USD in slot 1
anchor run set-oracle-source -- --mint <SSS_MINT> --slot 1 --type switchboard \
  --feed <SWITCHBOARD_SOL_USD_FEED>

# 4. Register Custom price feed in slot 2
anchor run set-oracle-source -- --mint <SSS_MINT> --slot 2 --type custom \
  --feed <CUSTOM_FEED_PDA>

# 5. Start permissionless keeper cranking
anchor run update-oracle-consensus -- --mint <SSS_MINT> \
  --feeds <FEED_0> <FEED_1> <FEED_2> <PLACEHOLDER> <PLACEHOLDER>
```

---

## Keeper Responsibilities

- Call `update_oracle_consensus` before each CDP borrow / liquidation cycle
  (or at least once per `max_age_slots` to keep TWAP current).
- Pass feeds in **slot-index order**; use any read-only placeholder pubkey for
  unconfigured slots.
- Monitor `OracleStalenessDetected` events — repeated staleness for a source
  indicates a feed that should be replaced via `set_oracle_source`.
- Monitor `OracleOutlierRejected` events — persistent outliers may indicate
  price manipulation or a broken feed.

---

## Integration with Oracle Abstraction (SSS-119)

Multi-oracle consensus is an opt-in **layer on top of** the oracle abstraction
introduced in SSS-119. When `FLAG_MULTI_ORACLE_CONSENSUS` is set:

- `last_consensus_price` replaces the single-source `oracle_type` / `oracle_feed`
  read in CDP and circuit breaker instructions.
- The per-source `oracle_type` config on `StablecoinConfig` remains valid for
  single-source fallback when the flag is unset.

---

## Test Coverage (SSS-153)

18 anchor tests in `tests/sss-153-multi-oracle-consensus.ts`:
- Init validation (bad args rejected)
- Source CRUD (add, update, remove)
- Staleness detection (slot-expired sources skipped)
- Outlier rejection (price outside threshold emits event and is excluded)
- TWAP fallback (triggered when `accepted_count < min_oracles`)
- Flag check (`MultiOracleNotEnabled` when flag absent)

---

## See Also

- [Oracle Abstraction](./ORACLE-ABSTRACTION.md) — single-source oracle adapter (SSS-119)
- [INSURANCE-VAULT.md](./INSURANCE-VAULT.md) — first-loss vault (SSS-151)
- [PROOF-OF-RESERVES.md](./PROOF-OF-RESERVES.md) — reserve reporting
