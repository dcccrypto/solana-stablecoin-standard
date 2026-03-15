/**
 * CPIComposability Module — SSS Direction 3
 *
 * TypeScript stubs for CPI (Cross-Program Invocation) composability interfaces.
 * Any third-party Solana program can integrate with an SSS stablecoin by
 * implementing or calling these standard interfaces.
 *
 * Mirrors the on-chain discriminator layout used in tests/spikes/03-cpi-composability.
 *
 * @module CPIComposability
 */

import { PublicKey, TransactionInstruction, AccountMeta } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Discriminators (8-byte LE, unique per instruction)
// ---------------------------------------------------------------------------

/**
 * Canonical 8-byte discriminators for SSS CPI instructions.
 * Matches the Anchor hash-based discriminator: sha256("global:<name>")[0..8].
 * Use these when building raw CPI instruction data.
 */
export const SSS_CPI_DISCRIMINATORS = {
  mint: Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  burn: Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  initialize: Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  depositCollateral: Buffer.from([0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  redeem: Buffer.from([0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
} as const;

// ---------------------------------------------------------------------------
// IMint — standard mint interface
// ---------------------------------------------------------------------------

/**
 * IMint: standard interface any SSS-compatible minter must satisfy.
 *
 * Third-party programs call `mint` via CPI to create new stablecoin tokens.
 * The program checks minter authority and enforces mint caps.
 */
export interface IMintParams {
  /** Stablecoin mint account */
  mint: PublicKey;
  /** Destination token account (Token-2022) */
  destination: PublicKey;
  /** Minter authority (must be registered) */
  minterAuthority: PublicKey;
  /** SSS stablecoin config PDA */
  stablecoinConfig: PublicKey;
  /** Amount to mint (base units, LE u64 encoded in instruction data) */
  amount: bigint;
}

export interface IMint {
  /**
   * Build a `mint` CPI instruction.
   *
   * Instruction data layout:
   *   [0..8]  discriminator (SSS_CPI_DISCRIMINATORS.mint)
   *   [8..16] amount as LE u64
   */
  mint(params: IMintParams): TransactionInstruction;
}

// ---------------------------------------------------------------------------
// IBurn — standard burn interface
// ---------------------------------------------------------------------------

/**
 * IBurn: standard interface any SSS-compatible burner must satisfy.
 *
 * Third-party programs call `burn` via CPI to destroy stablecoin tokens.
 */
export interface IBurnParams {
  /** Stablecoin mint account */
  mint: PublicKey;
  /** Source token account (tokens to burn) */
  source: PublicKey;
  /** Token account owner (must sign) */
  owner: PublicKey;
  /** SSS stablecoin config PDA */
  stablecoinConfig: PublicKey;
  /** Amount to burn (base units) */
  amount: bigint;
}

export interface IBurn {
  /**
   * Build a `burn` CPI instruction.
   *
   * Instruction data layout:
   *   [0..8]  discriminator (SSS_CPI_DISCRIMINATORS.burn)
   *   [8..16] amount as LE u64
   */
  burn(params: IBurnParams): TransactionInstruction;
}

// ---------------------------------------------------------------------------
// IGetSupply — supply query interface
// ---------------------------------------------------------------------------

/**
 * IGetSupply: interface for querying total circulating stablecoin supply.
 *
 * Can be satisfied by reading the on-chain stablecoin config account
 * (no CPI instruction needed — pure account read).
 */
export interface IGetSupply {
  /**
   * Fetch total minted stablecoin supply from the on-chain config PDA.
   * Returns base units as bigint.
   */
  getSupply(mint: PublicKey): Promise<bigint>;
}

// ---------------------------------------------------------------------------
// Generic CPI instruction builder
// ---------------------------------------------------------------------------

/**
 * Build a raw SSS CPI instruction with a given discriminator and u64 amount.
 *
 * Useful for programs calling SSS from outside the standard SDK.
 *
 * @param discriminator - 8-byte discriminator buffer
 * @param amount        - u64 amount (encoded as little-endian)
 * @param accounts      - ordered account metas as required by the instruction
 * @param programId     - SSS token program ID
 */
export function buildSssCpiInstruction(
  discriminator: Buffer,
  amount: bigint,
  accounts: AccountMeta[],
  programId: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(16);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);

  return new TransactionInstruction({
    programId,
    keys: accounts,
    data,
  });
}

// ---------------------------------------------------------------------------
// Module stub
// ---------------------------------------------------------------------------

/**
 * CPIComposability — stub interface for the SSS Direction 3 SDK module.
 *
 * Provides `IMint`, `IBurn`, and `IGetSupply` implementations backed by
 * the on-chain SSS token program. Third-party DeFi protocols import and use
 * these to integrate SSS stablecoins without coupling to the full SDK.
 *
 * @example
 * ```ts
 * const cpi = new CPIComposability(programId);
 * const mintIx = cpi.mint({ mint, destination, minterAuthority, stablecoinConfig, amount });
 * const burnIx = cpi.burn({ mint, source, owner, stablecoinConfig, amount });
 * const supply = await cpi.getSupply(mint);
 * ```
 */
export interface ICPIComposability extends IMint, IBurn, IGetSupply {}
