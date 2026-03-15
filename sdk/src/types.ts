import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';

export type Preset = 'SSS-1' | 'SSS-2' | 'SSS-3';

export interface SssConfig {
  /** Token-2022 preset */
  preset: Preset;
  /** Token decimals (default: 6) */
  decimals?: number;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Metadata URI */
  uri?: string;
  /** Transfer hook program (required for SSS-2) */
  transferHookProgram?: PublicKey;
  /** SSS-3: collateral token mint (e.g. USDC mint) */
  collateralMint?: PublicKey;
  /** SSS-3: reserve vault token account address */
  reserveVault?: PublicKey;
  /** Maximum token supply (undefined / 0n = unlimited) */
  maxSupply?: bigint;
}

export interface MintParams {
  mint: PublicKey;
  amount: bigint;
  recipient: PublicKey;
}

export interface BurnParams {
  mint: PublicKey;
  amount: bigint;
  source: PublicKey;
}

export interface FreezeParams {
  mint: PublicKey;
  targetTokenAccount: PublicKey;
}

export interface MinterConfig {
  /** Minter public key */
  minter: PublicKey;
  /** Maximum mint cap (0 = unlimited) */
  cap?: bigint;
}

export interface UpdateMinterParams {
  /** The minter public key to register or update */
  minter: PublicKey;
  /** Maximum mint cap in base units (0 = unlimited) */
  cap: bigint;
}

export interface RevokeMinterParams {
  /** The minter public key to revoke */
  minter: PublicKey;
}

export interface UpdateRolesParams {
  /** New admin authority (omit to leave unchanged) */
  newAuthority?: PublicKey;
  /** New compliance authority (omit to leave unchanged) */
  newComplianceAuthority?: PublicKey;
}

/** Parameters for the two-step authority transfer */
export interface ProposeAuthorityParams {
  /** The proposed new admin authority */
  proposed: PublicKey;
}

/** Parameters for depositing collateral (SSS-3) */
export interface DepositCollateralParams {
  /** Amount of collateral tokens to deposit (base units) */
  amount: bigint;
  /** Depositor's collateral token account */
  depositorCollateral: PublicKey;
  /** Reserve vault token account */
  reserveVault: PublicKey;
  /** Collateral token mint */
  collateralMint: PublicKey;
}

/** Parameters for redeeming collateral (SSS-3) */
export interface RedeemParams {
  /** Amount of SSS tokens to burn for collateral redemption (base units) */
  amount: bigint;
  /** Redeemer's SSS token account */
  redeemerSssAccount: PublicKey;
  /** Collateral token mint */
  collateralMint: PublicKey;
  /** Reserve vault token account */
  reserveVault: PublicKey;
  /** Redeemer's collateral token account (receives collateral) */
  redeemerCollateral: PublicKey;
  /** Token program for collateral (usually TOKEN_PROGRAM_ID) */
  collateralTokenProgram?: PublicKey;
}

export interface StablecoinInfo {
  mint: PublicKey;
  authority: PublicKey;
  complianceAuthority: PublicKey;
  /** Pending admin authority (set during two-step transfer, default pubkey if none) */
  pendingAuthority?: PublicKey;
  /** Pending compliance authority (set during two-step transfer, default pubkey if none) */
  pendingComplianceAuthority?: PublicKey;
  preset: number;
  paused: boolean;
  totalMinted: bigint;
  totalBurned: bigint;
  circulatingSupply: bigint;
  /** Maximum token supply (0n = unlimited) */
  maxSupply?: bigint;
  /** SSS-3: collateral token mint */
  collateralMint?: PublicKey;
  /** SSS-3: accumulated collateral held in reserve */
  totalCollateral?: bigint;
}

export interface SdkOptions {
  connection: Connection;
  provider: AnchorProvider;
  programId?: PublicKey;
}
