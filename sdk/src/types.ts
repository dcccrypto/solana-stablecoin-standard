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
