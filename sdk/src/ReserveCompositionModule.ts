import { Connection, PublicKey } from '@solana/web3.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Breakdown of backing asset types for a stablecoin reserve, in basis points. */
export interface ReserveCompositionData {
  /** The stablecoin mint address. */
  ssssMint: PublicKey;
  /** Cash and cash equivalents (0–10000 basis points). */
  cashBps: number;
  /** US Treasury Bills (0–10000 basis points). */
  tBillsBps: number;
  /** Crypto assets (0–10000 basis points). */
  cryptoBps: number;
  /** Other assets (0–10000 basis points). */
  otherBps: number;
  /** Solana slot at which the composition was last updated. */
  lastUpdatedSlot: bigint;
  /** Authority pubkey that last submitted the update. */
  lastUpdatedBy: PublicKey;
}

// ─── ReserveCompositionModule ─────────────────────────────────────────────────

/**
 * ReserveCompositionModule — SSS-124.
 *
 * Provides helpers for the `ReserveComposition` PDA:
 * - `fetchReserveComposition`: read the on-chain breakdown for a mint.
 * - `deriveReserveCompositionPda`: deterministically derive the PDA address.
 *
 * @example
 * ```typescript
 * const mod = new ReserveCompositionModule(connection, programId);
 * const comp = await mod.fetchReserveComposition(mintPublicKey);
 * console.log(`Cash: ${comp.cashBps / 100}%`);
 * ```
 */
export class ReserveCompositionModule {
  static readonly SEED = Buffer.from('reserve-composition');

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
  ) {}

  /**
   * Derive the `ReserveComposition` PDA address for a given mint.
   */
  deriveReserveCompositionPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ReserveCompositionModule.SEED, mint.toBuffer()],
      this.programId,
    );
  }

  /**
   * Fetch and decode the `ReserveComposition` PDA for `mint`.
   *
   * Returns `null` if the account does not exist (composition never set).
   * Throws on connection or decode errors.
   */
  async fetchReserveComposition(mint: PublicKey): Promise<ReserveCompositionData | null> {
    const [pda] = this.deriveReserveCompositionPda(mint);
    const accountInfo = await this.connection.getAccountInfo(pda);
    if (!accountInfo) return null;

    // Decode raw account data (skip 8-byte discriminator)
    const data = accountInfo.data;
    let offset = 8;

    const readPubkey = () => {
      const pk = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      return pk;
    };
    const readU16 = () => {
      const v = data.readUInt16LE(offset);
      offset += 2;
      return v;
    };
    const readU64 = () => {
      const v = data.readBigUInt64LE(offset);
      offset += 8;
      return v;
    };

    const ssssMint = readPubkey();
    const cashBps = readU16();
    const tBillsBps = readU16();
    const cryptoBps = readU16();
    const otherBps = readU16();
    const lastUpdatedSlot = readU64();
    const lastUpdatedBy = readPubkey();

    return {
      ssssMint,
      cashBps,
      tBillsBps,
      cryptoBps,
      otherBps,
      lastUpdatedSlot,
      lastUpdatedBy,
    };
  }
}
