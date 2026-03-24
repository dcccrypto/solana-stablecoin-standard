from enum import IntFlag


class FeatureFlags(IntFlag):
    """Feature flag bits for StablecoinConfig.feature_flags (u64).

    Bit assignments must match the Anchor program's state.rs exactly.
    See docs/FEATURE-FLAGS.md for the full registry.
    """

    CIRCUIT_BREAKER = 1 << 0         # bit 0  — halt all mint/burn
    SPEND_POLICY = 1 << 1            # bit 1  — per-wallet spend limits
    DAO_COMMITTEE = 1 << 2           # bit 2  — DAO governance committee
    YIELD_COLLATERAL = 1 << 3        # bit 3  — yield-bearing collateral
    ZK_COMPLIANCE = 1 << 4           # bit 4  — ZK compliance checks
    CONFIDENTIAL_TRANSFERS = 1 << 5  # bit 5  — SPL confidential transfers
    # bits 6–8: reserved
    SANCTIONS_ORACLE = 1 << 9        # bit 9  — on-chain sanctions screening
    ZK_CREDENTIALS = 1 << 10         # bit 10 — ZK credential registry
    PID_FEE_CONTROL = 1 << 11        # bit 11 — PID stability fee auto-adjustment
    GRAD_LIQUIDATION_BONUS = 1 << 12 # bit 12 — graduated liquidation bonus tiers
    PSM_DYNAMIC_FEES = 1 << 13       # bit 13 — PSM AMM-style dynamic fees
    WALLET_RATE_LIMITS = 1 << 14     # bit 14 — per-wallet rate limiting
    SQUADS_AUTHORITY = 1 << 15       # bit 15 — Squads V4 multisig authority
    POR_HALT_ON_BREACH = 1 << 16     # bit 16 — halt on proof-of-reserves breach
    BRIDGE_ENABLED = 1 << 17         # bit 17 — cross-chain bridge (Wormhole/LayerZero)
