from enum import IntFlag


class FeatureFlags(IntFlag):
    CIRCUIT_BREAKER = 1 << 0
    SPEND_POLICY = 1 << 1
    DAO_COMMITTEE = 1 << 2
    YIELD_COLLATERAL = 1 << 3
    ZK_COMPLIANCE = 1 << 4
    CONFIDENTIAL_TRANSFERS = 1 << 5
    BRIDGE_ENABLED = 1 << 13
    POR_HALT_ON_BREACH = 1 << 14
