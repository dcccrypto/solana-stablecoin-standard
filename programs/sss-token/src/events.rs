use anchor_lang::prelude::*;

#[event]
pub struct TokenInitialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub preset: u8,
    pub max_supply: u64,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub total_minted: u64,
}

#[event]
pub struct TokensBurned {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

#[event]
pub struct AccountFrozen {
    pub mint: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct AccountThawed {
    pub mint: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct MintPausedEvent {
    pub mint: Pubkey,
    pub paused: bool,
}

#[event]
pub struct CollateralDeposited {
    pub mint: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub total_collateral: u64,
}

#[event]
pub struct CollateralRedeemed {
    pub mint: Pubkey,
    pub redeemer: Pubkey,
    pub amount: u64,
    pub total_collateral: u64,
}

#[event]
pub struct AuthorityProposed {
    pub mint: Pubkey,
    pub proposed: Pubkey,
    pub is_compliance: bool,
}

#[event]
pub struct AuthorityAccepted {
    pub mint: Pubkey,
    pub new_authority: Pubkey,
    pub is_compliance: bool,
}

/// SSS-093: Emitted on every PSM redeem (deposit_collateral→mint is fee-free).
#[event]
pub struct PsmSwapEvent {
    pub mint: Pubkey,
    pub redeemer: Pubkey,
    /// SSS tokens burned by the redeemer.
    pub sss_burned: u64,
    /// Collateral tokens released to the redeemer (sss_burned - fee_collected).
    pub collateral_out: u64,
    /// Collateral retained in vault as fee.
    pub fee_collected: u64,
    /// Fee rate at time of swap in basis points.
    pub fee_bps: u16,
}

/// SSS-093: Emitted when the PSM redemption fee is updated.
#[event]
pub struct PsmFeeUpdated {
    pub mint: Pubkey,
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
    pub authority: Pubkey,
}

/// SSS-093: Emitted when a minter's per-epoch velocity limit is updated.
#[event]
pub struct MintVelocityUpdated {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub max_mint_per_epoch: u64,
    pub authority: Pubkey,
}

// ─── SSS-110: CDP on-chain events ────────────────────────────────────────────

/// Emitted when collateral is deposited into a CDP vault.
#[event]
pub struct CdpCollateralDeposited {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub amount: u64,
    pub vault_total: u64,
}

/// Emitted when SSS tokens are borrowed against collateral.
#[event]
pub struct CdpBorrowed {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub amount_borrowed: u64,
    pub total_debt: u64,
}

/// Emitted when SSS tokens are repaid and collateral is released.
#[event]
pub struct CdpRepaid {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub amount_repaid: u64,
    pub collateral_released: u64,
    pub remaining_debt: u64,
}

/// Emitted when a CDP position is liquidated (SSS-110 circuit breaker compatible).
#[event]
pub struct CdpLiquidated {
    pub sss_mint: Pubkey,
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub collateral_mint: Pubkey,
    pub debt_burned: u64,
    pub collateral_seized: u64,
    /// Collateral ratio at time of liquidation (in basis points).
    pub ratio_bps: u64,
}

/// SSS-100: Emitted on every CDP liquidation (full and partial) with multi-collateral details.
#[event]
pub struct CollateralLiquidated {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// The specific collateral mint seized.
    pub collateral_mint: Pubkey,
    /// The CDP owner whose position was (partially) liquidated.
    pub cdp_owner: Pubkey,
    /// The liquidator who initiated the liquidation.
    pub liquidator: Pubkey,
    /// Amount of SSS debt burned.
    pub debt_burned: u64,
    /// Amount of collateral transferred to the liquidator.
    pub collateral_seized: u64,
    /// Collateral ratio before liquidation (basis points).
    pub ratio_before_bps: u64,
    /// Whether this was a partial liquidation (true) or full (false).
    pub partial: bool,
    /// Liquidation bonus applied in basis points (from CollateralConfig or global default).
    pub bonus_bps: u16,
}

// ---------------------------------------------------------------------------
// SSS-135: Cross-chain bridge events
// ---------------------------------------------------------------------------

/// Emitted when tokens are bridged out of Solana.
#[event]
pub struct BridgeOut {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// The sender who initiated the bridge-out.
    pub sender: Pubkey,
    /// Net tokens burned (after fee deduction).
    pub amount: u64,
    /// Fee burned (in native token units, 0 if bridge_fee_bps == 0).
    pub fee_amount: u64,
    /// Target chain ID (Wormhole chain ID or LayerZero chain ID).
    pub target_chain: u16,
    /// Recipient address on the target chain (32-byte universal address).
    pub recipient_address: [u8; 32],
    /// Bridge type: 1 = Wormhole, 2 = LayerZero.
    pub bridge_type: u8,
}

/// Emitted when tokens are bridged into Solana.
#[event]
pub struct BridgeIn {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// The recipient who received the minted tokens.
    pub recipient: Pubkey,
    /// Tokens minted.
    pub amount: u64,
    /// Source chain ID.
    pub source_chain: u16,
    /// Bridge type: 1 = Wormhole, 2 = LayerZero.
    pub bridge_type: u8,
}

/// Emitted when bridge config is initialized.
#[event]
pub struct BridgeConfigInitialized {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// Bridge type.
    pub bridge_type: u8,
    /// Bridge program address.
    pub bridge_program: Pubkey,
    /// Max bridge amount per tx (0 = unlimited).
    pub max_bridge_amount_per_tx: u64,
    /// Fee in basis points.
    pub bridge_fee_bps: u16,
}

// ---------------------------------------------------------------------------
// SSS-137: Redemption pool events
// ---------------------------------------------------------------------------

/// Emitted when authority seeds the redemption pool with reserve assets.
#[event]
pub struct RedemptionPoolSeeded {
    pub sss_mint: Pubkey,
    pub amount: u64,
    pub new_liquidity: u64,
}

/// Emitted when a user performs an instant redemption (burns SSS, receives reserves).
#[event]
pub struct InstantRedemption {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    /// SSS tokens burned.
    pub burned: u64,
    /// Reserve assets received after fee.
    pub received: u64,
    /// Fee deducted from payout.
    pub fee: u64,
    /// Pool liquidity remaining after redemption.
    pub remaining_liquidity: u64,
}

/// Emitted when anyone replenishes the pool.
#[event]
pub struct RedemptionPoolReplenished {
    pub sss_mint: Pubkey,
    pub replenisher: Pubkey,
    pub amount: u64,
    pub new_liquidity: u64,
}

/// Emitted when authority drains the pool.
#[event]
pub struct RedemptionPoolDrained {
    pub sss_mint: Pubkey,
    pub amount: u64,
}
