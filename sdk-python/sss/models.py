from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SupplyResponse:
    total_supply: int
    circulating_supply: int
    token_mint: str
    slot: int
    timestamp: int


@dataclass
class ReserveRatio:
    ratio: float          # e.g. 1.05 means 105%
    token_mint: str
    slot: int
    is_healthy: bool


@dataclass
class CDPPosition:
    position_id: str
    owner: str
    collateral_amount: int
    debt_amount: int
    collateral_token: str
    health_factor: float
    is_liquidatable: bool


@dataclass
class PegDeviation:
    token_mint: str
    current_price: float  # in USD
    target_price: float   # e.g. 1.00
    deviation_bps: int    # basis points
    slot: int


@dataclass
class ReserveComposition:
    asset: str
    amount: int
    weight_bps: int       # basis points, sum = 10000
    usd_value: float


@dataclass
class SupplySnapshot:
    slot: int
    timestamp: int
    total_supply: int
    circulating_supply: int


@dataclass
class StabilityScore:
    score: float          # 0.0 to 1.0
    components: dict      # breakdown by component
    slot: int
