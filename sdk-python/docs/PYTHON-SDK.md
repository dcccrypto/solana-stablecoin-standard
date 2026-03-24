# Solana Stablecoin Standard — Python SDK

Python client library and CLI for the Solana Stablecoin Standard (SSS) protocol.

---

## Installation

Install from PyPI (once published) or directly from the repository:

```bash
# Core install
pip install solana-stablecoin-standard

# With pandas analytics support
pip install 'solana-stablecoin-standard[analytics]'

# Development dependencies
pip install 'solana-stablecoin-standard[dev]'
```

Requires Python 3.10 or later.

---

## Quick Start (async context manager)

All network calls are async. Use `SSSClient` as an async context manager to ensure the underlying HTTP client is properly closed:

```python
import asyncio
from sss import SSSClient

async def main():
    async with SSSClient(
        backend_url="http://127.0.0.1:18801",
        rpc_url="https://api.devnet.solana.com",
    ) as client:
        # Fetch current supply
        supply = await client.get_supply()
        print(f"Total supply: {supply.total_supply}")
        print(f"Circulating: {supply.circulating_supply}")

        # Fetch reserve ratio
        reserve = await client.get_reserve_ratio()
        print(f"Reserve ratio: {reserve.ratio:.2%}  healthy={reserve.is_healthy}")

        # Fetch CDP positions at risk
        risky = await client.get_cdp_positions(liquidatable=True)
        for pos in risky:
            print(f"  {pos.position_id}  hf={pos.health_factor:.3f}")

        # Peg deviation
        peg = await client.get_peg_deviation()
        print(f"Price: ${peg.current_price:.4f}  deviation: {peg.deviation_bps} bps")

        # Stability score (0.0 – 1.0)
        score = await client.compute_stability_score()
        print(f"Stability score: {score:.3f}")

asyncio.run(main())
```

### Without the context manager

```python
client = SSSClient(backend_url="http://127.0.0.1:18801")
try:
    supply = await client.get_supply(token_mint="So11111111111111111111111111111111111111112")
finally:
    await client.close()
```

---

## CLI Usage

After installation the `sss-cli` command is available on your PATH.

### `sss-cli balance <ADDRESS>`

Fetch the SOL balance for a wallet address.

```bash
sss-cli balance 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin
# Balance: 1.500000000 SOL (1500000000 lamports)

# Use a custom RPC endpoint
sss-cli balance 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --rpc https://api.mainnet-beta.solana.com
```

### `sss-cli supply`

Fetch the current stablecoin supply from the backend.

```bash
sss-cli supply
# {
#   "token_mint": "So11111111111111111111111111111111111111112",
#   "total_supply": 1000000000000,
#   "circulating_supply": 950000000000,
#   "slot": 123456789,
#   "timestamp": 1711234567
# }

# Filter by mint
sss-cli supply --mint So11111111111111111111111111111111111111112

# Point at a different backend
sss-cli supply --backend http://my-backend.example.com:18801
```

### `sss-cli reserve`

Fetch the current reserve ratio.

```bash
sss-cli reserve
# {
#   "token_mint": "So11111111111111111111111111111111111111112",
#   "ratio": 1.05,
#   "is_healthy": true,
#   "slot": 123456789
# }

sss-cli reserve --mint So11111111111111111111111111111111111111112 \
                --backend http://127.0.0.1:18801
```

### `sss-cli cdps`

List CDP (collateralised debt positions).

```bash
# All positions
sss-cli cdps

# Filter by owner
sss-cli cdps --owner 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin

# Only liquidatable positions
sss-cli cdps --liquidatable

# Combine filters
sss-cli cdps --owner 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin --liquidatable
```

---

## FeatureFlags

`FeatureFlags` is a Python `IntFlag` enum. Use it to inspect or compose protocol feature bitmasks read from on-chain `StablecoinConfig` accounts.

```python
from sss import FeatureFlags

# Check a single flag
flags = FeatureFlags.CIRCUIT_BREAKER | FeatureFlags.ZK_COMPLIANCE
assert flags & FeatureFlags.CIRCUIT_BREAKER   # True
assert not (flags & FeatureFlags.DAO_COMMITTEE)  # False

# All flags
print(list(FeatureFlags))
# [<FeatureFlags.CIRCUIT_BREAKER: 1>, <FeatureFlags.SPEND_POLICY: 2>, ...]
```

Available flags and their bit positions:

| Flag | Bit | Value |
|---|---|---|
| `CIRCUIT_BREAKER` | 0 | 1 |
| `SPEND_POLICY` | 1 | 2 |
| `DAO_COMMITTEE` | 2 | 4 |
| `YIELD_COLLATERAL` | 3 | 8 |
| `ZK_COMPLIANCE` | 4 | 16 |
| `CONFIDENTIAL_TRANSFERS` | 5 | 32 |
| `BRIDGE_ENABLED` | 13 | 8192 |
| `POR_HALT_ON_BREACH` | 14 | 16384 |

---

## PDA Derivation

The `sss.pda` module provides helpers to derive program-derived addresses for common SSS accounts. All functions accept string-encoded public keys and return `(pda_address: str, bump: int)`.

```python
from sss.pda import (
    find_stablecoin_config,
    find_cdp_position,
    find_wallet_rate_limit,
    find_zk_compliance_record,
)

PROGRAM_ID = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
MINT       = "So11111111111111111111111111111111111111112"
OWNER      = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"

# StablecoinConfig PDA
config_pda, config_bump = find_stablecoin_config(PROGRAM_ID, MINT)
print(config_pda, config_bump)

# CDPPosition PDA (mint + owner)
cdp_pda, cdp_bump = find_cdp_position(PROGRAM_ID, MINT, OWNER)
print(cdp_pda, cdp_bump)

# WalletRateLimit PDA
rl_pda, rl_bump = find_wallet_rate_limit(PROGRAM_ID, OWNER)

# ZkComplianceRecord PDA (mint + wallet)
zk_pda, zk_bump = find_zk_compliance_record(PROGRAM_ID, MINT, OWNER)
```

---

## Error Handling

All SDK errors inherit from `SSSError`. Import the specific subclass you want to catch:

```python
from sss.exceptions import SSSError, SSSNetworkError, SSSAuthError, SSSValidationError

async with SSSClient() as client:
    try:
        supply = await client.get_supply()
    except SSSAuthError as e:
        # 401 or 403 — check your credentials
        print(f"Auth failed ({e.status_code}): {e.message}")
    except SSSValidationError as e:
        # 422 — malformed request or invalid parameters
        print(f"Validation error ({e.status_code}): {e.message}")
    except SSSNetworkError as e:
        # 5xx or TCP-level failure
        print(f"Network/server error ({e.status_code}): {e.message}")
    except SSSError as e:
        # Any other SDK error
        print(f"SDK error: {e.message}")
```

All `SSSError` subclasses expose:
- `e.message` — human-readable description
- `e.status_code` — HTTP status code, or `None` for transport errors

---

## Analytics (pandas export)

When the `analytics` extra is installed, you can convert any list of SDK model objects into a `pandas.DataFrame`:

```python
import asyncio
from sss import SSSClient

async def main():
    async with SSSClient() as client:
        history = await client.get_historical_supply(from_slot=100_000, to_slot=200_000)
        df = client.export_to_dataframe(history)
        print(df.dtypes)
        print(df.describe())

        # Reserve composition as a DataFrame
        composition = await client.get_reserve_composition()
        df_comp = client.export_to_dataframe(composition)
        print(df_comp[["asset", "weight_bps", "usd_value"]])

asyncio.run(main())
```

If `pandas` is not installed, `export_to_dataframe` raises an `ImportError` with installation instructions.

### WebSocket event streaming

Subscribe to real-time protocol events:

```python
import asyncio
from sss import SSSClient

async def on_event(event: dict) -> None:
    print(f"[{event['type']}]", event)

async def main():
    async with SSSClient(backend_url="http://127.0.0.1:18801") as client:
        await client.subscribe_to_events(
            event_types=["supply_change", "cdp_liquidation", "peg_deviation"],
            callback=on_event,
        )

asyncio.run(main())
```
