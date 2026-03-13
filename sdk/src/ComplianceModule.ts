import { Connection, PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import { freezeAccount, thawAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

/**
 * ComplianceModule — SSS-2 blacklist + freeze/thaw operations.
 * Wraps the transfer-hook blacklist and Token-2022 freeze authority.
 */
export class ComplianceModule {
  private readonly provider: AnchorProvider;
  private readonly mint: PublicKey;
  private readonly hookProgramId: PublicKey;

  static readonly BLACKLIST_SEED = Buffer.from('blacklist-state');

  constructor(
    provider: AnchorProvider,
    mint: PublicKey,
    hookProgramId: PublicKey
  ) {
    this.provider = provider;
    this.mint = mint;
    this.hookProgramId = hookProgramId;
  }

  /**
   * Derive the blacklist state PDA for this mint.
   */
  getBlacklistPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ComplianceModule.BLACKLIST_SEED, this.mint.toBuffer()],
      this.hookProgramId
    );
  }

  /**
   * Freeze a token account — prevents any transfers.
   * Uses the Token-2022 freeze authority (held by the compliance authority).
   */
  async freezeAccount(
    targetTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    return freezeAccount(
      this.provider.connection,
      this.provider.wallet as any,
      targetTokenAccount,
      this.mint,
      this.provider.wallet.publicKey,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  /**
   * Thaw a frozen token account.
   */
  async thawAccount(
    targetTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    return thawAccount(
      this.provider.connection,
      this.provider.wallet as any,
      targetTokenAccount,
      this.mint,
      this.provider.wallet.publicKey,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  /**
   * Check if an address is on the on-chain blacklist.
   * Reads the blacklist PDA account data from the transfer hook program.
   */
  async isBlacklisted(address: PublicKey): Promise<boolean> {
    const [pda] = this.getBlacklistPda();
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return false;

    // Parse the blacklist account data
    // Layout: discriminator(8) + mint(32) + authority(32) + vec_len(4) + entries(32 each)
    const data = accountInfo.data;
    const DISC_SIZE = 8;
    const PUBKEY_SIZE = 32;
    const VEC_LEN_OFFSET = DISC_SIZE + PUBKEY_SIZE + PUBKEY_SIZE; // 72

    if (data.length < VEC_LEN_OFFSET + 4) return false;

    const vecLen = data.readUInt32LE(VEC_LEN_OFFSET);
    const entriesOffset = VEC_LEN_OFFSET + 4;

    for (let i = 0; i < vecLen; i++) {
      const start = entriesOffset + i * PUBKEY_SIZE;
      if (start + PUBKEY_SIZE > data.length) break;
      const pk = new PublicKey(data.slice(start, start + PUBKEY_SIZE));
      if (pk.equals(address)) return true;
    }

    return false;
  }
}
