/**
 * CDPVault Module — SSS Direction 2
 *
 * TypeScript stubs for the Multi-Collateral CDP (Collateralized Debt Position)
 * vault system. Vaults accept collateral tokens (SOL, wBTC, wETH, etc.),
 * enforce collateral ratios via Pyth/Switchboard price feeds, and support
 * on-chain liquidation of undercollateralized positions.
 *
 * @module CDPVault
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Supported oracle providers for price feeds */
export type OracleProvider = 'pyth' | 'switchboard';

/** Vault lifecycle state */
export type VaultStatus = 'healthy' | 'at-risk' | 'liquidatable' | 'closed';

// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

/**
 * On-chain `CdpConfig` PDA (seeds: ["cdp-config", mint]).
 * 128 bytes: global CDP parameters.
 */
export interface CdpConfigAccount {
  /** Stablecoin mint this CDP issues */
  stableMint: PublicKey;
  /** Minimum collateral ratio in basis points (e.g. 15000 = 150%) */
  minCollateralRatioBps: number;
  /** Liquidation threshold in basis points (e.g. 12000 = 120%) */
  liquidationThresholdBps: number;
  /** Liquidation bonus for liquidators in basis points (e.g. 500 = 5%) */
  liquidationBonusBps: number;
  /** Authority that can update config */
  authority: PublicKey;
}

/**
 * On-chain `CollateralType` PDA (seeds: ["collateral", mint, collateral_mint]).
 * 96 bytes per accepted collateral.
 */
export interface CollateralTypeAccount {
  /** Collateral token mint */
  collateralMint: PublicKey;
  /** Oracle provider */
  oracle: OracleProvider;
  /** Oracle price account public key */
  priceAccount: PublicKey;
  /** Whether this collateral type is active */
  enabled: boolean;
}

/**
 * On-chain `Vault` PDA (seeds: ["vault", owner, vault_id]).
 * 256 bytes per position.
 */
export interface VaultAccount {
  /** Vault owner */
  owner: PublicKey;
  /** Collateral token mint deposited */
  collateralMint: PublicKey;
  /** Amount of collateral locked in the vault (base units) */
  collateralAmount: bigint;
  /** Amount of stablecoin minted against this vault (base units) */
  debtAmount: bigint;
  /** Vault health status (derived, not stored on-chain) */
  status?: VaultStatus;
  /** Vault nonce / id (used in PDA seed) */
  vaultId: bigint;
}

// ---------------------------------------------------------------------------
// Instruction params
// ---------------------------------------------------------------------------

/**
 * Parameters for `open_vault`.
 * Creates a new CDP vault with an initial collateral deposit.
 */
export interface OpenVaultParams {
  /** Collateral token mint to use */
  collateralMint: PublicKey;
  /** Initial collateral amount (base units) */
  initialDeposit: bigint;
  /** Owner's collateral token account */
  ownerCollateralAccount: PublicKey;
  /** Owner signer */
  owner: PublicKey;
  /** Stablecoin mint */
  stableMint: PublicKey;
}

/**
 * Parameters for `deposit_collateral` (CDP vault).
 * Adds more collateral to an existing CDP vault.
 */
export interface CDPDepositCollateralParams {
  /** Vault PDA address */
  vault: PublicKey;
  /** Amount of collateral to add (base units) */
  amount: bigint;
  /** Owner's collateral token account */
  ownerCollateralAccount: PublicKey;
  /** Vault escrow collateral token account */
  vaultCollateralAccount: PublicKey;
}

/**
 * Parameters for `mint_stablecoin`.
 * Mints stablecoin against the vault's collateral — checks ratio first.
 */
export interface MintStableParams {
  /** Vault PDA address */
  vault: PublicKey;
  /** Amount of stablecoin to mint (base units) */
  amount: bigint;
  /** Recipient token account for minted stable */
  recipientAccount: PublicKey;
  /** Owner signer */
  owner: PublicKey;
  /** Pyth/Switchboard price account (read-only) */
  priceAccount: PublicKey;
}

/**
 * Parameters for `liquidate`.
 * Callable by anyone when vault collateral ratio < liquidation threshold.
 * Liquidator repays debt and receives collateral + bonus.
 */
export interface LiquidateParams {
  /** Vault PDA to liquidate */
  vault: PublicKey;
  /** Liquidator's stable token account (pays the debt) */
  liquidatorStableAccount: PublicKey;
  /** Liquidator's collateral token account (receives collateral) */
  liquidatorCollateralAccount: PublicKey;
  /** Liquidator signer */
  liquidator: PublicKey;
  /** Pyth/Switchboard price account (read-only) */
  priceAccount: PublicKey;
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/** Vault health summary (computed client-side from oracle price + vault data) */
export interface VaultHealth {
  /** Current collateral ratio in basis points */
  collateralRatioBps: number;
  /** True if above minimum ratio */
  isHealthy: boolean;
  /** True if below liquidation threshold */
  isLiquidatable: boolean;
  /** Maximum additional stable the owner can mint right now */
  maxMintable: bigint;
}

// ---------------------------------------------------------------------------
// Module stub
// ---------------------------------------------------------------------------

/**
 * CDPVault — stub interface for the SSS Direction 2 SDK module.
 *
 * @example
 * ```ts
 * const cdp = new CDPVault(connection, programId);
 * const ix = await cdp.openVault({ collateralMint, initialDeposit, ... });
 * const health = await cdp.getVaultHealth(vaultPubkey, priceAccount);
 * ```
 */
export interface ICDPVault {
  /** Build an `open_vault` instruction */
  openVault(params: OpenVaultParams): Promise<TransactionInstruction>;

  /** Build a `deposit_collateral` instruction */
  depositCollateral(params: CDPDepositCollateralParams): Promise<TransactionInstruction>;

  /** Build a `mint_stablecoin` instruction */
  mintStable(params: MintStableParams): Promise<TransactionInstruction>;

  /** Build a `liquidate` instruction */
  liquidate(params: LiquidateParams): Promise<TransactionInstruction>;

  /** Fetch a vault account */
  fetchVault(vault: PublicKey): Promise<VaultAccount | null>;

  /** Compute vault health from current oracle price */
  getVaultHealth(vault: PublicKey, priceAccount: PublicKey): Promise<VaultHealth>;
}

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

/**
 * Derive the `Vault` PDA for a given owner + vault_id.
 *
 * Seeds: ["vault", owner, vault_id_le_u64]
 */
export async function findVaultPda(
  stableMint: PublicKey,
  owner: PublicKey,
  vaultId: bigint,
  programId: PublicKey,
): Promise<[PublicKey, number]> {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(vaultId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), stableMint.toBuffer(), owner.toBuffer(), idBuf],
    programId,
  );
}

/**
 * Derive the `CdpConfig` PDA for a stablecoin mint.
 *
 * Seeds: ["cdp-config", mint]
 */
export async function findCdpConfigPda(
  mint: PublicKey,
  programId: PublicKey,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('cdp-config'), mint.toBuffer()],
    programId,
  );
}
