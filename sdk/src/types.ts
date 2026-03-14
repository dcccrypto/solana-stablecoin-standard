import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';

export type Preset = 'SSS-1' | 'SSS-2';

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
  /** SSS-3: collateral token mint (e.g. USDC mint address) */
  collateralMint?: PublicKey | null;
  /** SSS-3: reserve vault token account address */
  reserveVault?: PublicKey | null;
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

export interface StablecoinInfo {
  mint: PublicKey;
  authority: PublicKey;
  complianceAuthority: PublicKey;
  preset: number;
  paused: boolean;
  totalMinted: bigint;
  totalBurned: bigint;
  circulatingSupply: bigint;
}

export interface SdkOptions {
  connection: Connection;
  provider: AnchorProvider;
  programId?: PublicKey;
}
