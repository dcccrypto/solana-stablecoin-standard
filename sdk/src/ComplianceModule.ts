import { Connection, PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
// freezeAccount/thawAccount imports removed — those methods are deprecated in
// favour of SolanaStablecoin.freeze()/thaw() which CPI through the program.

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
   * Initialize the blacklist state PDA for this mint.
   * Must be called once after deploying an SSS-2 stablecoin before
   * `addToBlacklist` / `removeFromBlacklist` can be used.
   * Caller must be the compliance authority.
   */
  async initializeBlacklist(): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const [blacklistState] = this.getBlacklistPda();
    return program.methods
      .initializeExtraAccountMetaList()
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint: this.mint,
        blacklistState,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Add an address to the on-chain blacklist.
   * Calls `blacklist_add` on the transfer-hook program via Anchor.
   * Caller must be the compliance authority recorded in `BlacklistState`.
   */
  async addToBlacklist(address: PublicKey): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const [blacklistState] = this.getBlacklistPda();
    return program.methods
      .blacklistAdd(address)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint: this.mint,
        blacklistState,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Remove an address from the on-chain blacklist.
   * Calls `blacklist_remove` on the transfer-hook program via Anchor.
   * Caller must be the compliance authority recorded in `BlacklistState`.
   */
  async removeFromBlacklist(address: PublicKey): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const [blacklistState] = this.getBlacklistPda();
    return program.methods
      .blacklistRemove(address)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint: this.mint,
        blacklistState,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * @deprecated Use `SolanaStablecoin.freeze()` instead. The config PDA is the
   * freeze authority, so freeze must go through the sss-token program (CPI).
   * This method cannot work because the wallet is not the freeze authority.
   */
  async freezeAccount(
    _targetTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    throw new Error(
      'ComplianceModule.freezeAccount is deprecated: the config PDA is the freeze authority, ' +
      'not the wallet. Use SolanaStablecoin.freeze() which calls the sss-token program instruction.'
    );
  }

  /**
   * @deprecated Use `SolanaStablecoin.thaw()` instead. The config PDA is the
   * freeze authority, so thaw must go through the sss-token program (CPI).
   * This method cannot work because the wallet is not the freeze authority.
   */
  async thawAccount(
    _targetTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    throw new Error(
      'ComplianceModule.thawAccount is deprecated: the config PDA is the freeze authority, ' +
      'not the wallet. Use SolanaStablecoin.thaw() which calls the sss-token program instruction.'
    );
  }

  /**
   * Fetch the full on-chain blacklist as an array of PublicKeys.
   * Reads the `BlacklistState` account via the Anchor IDL account fetch.
   * Returns an empty array if the blacklist has not been initialized yet.
   */
  async getBlacklist(): Promise<PublicKey[]> {
    const program = await this._loadProgram();
    const [pda] = this.getBlacklistPda();
    try {
      const state = await program.account.blacklistState.fetch(pda);
      return state.blacklisted as PublicKey[];
    } catch {
      // Account doesn't exist yet (not initialized) — return empty list
      return [];
    }
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

  /**
   * Load the Anchor program instance for the transfer-hook (lazy, cached).
   * @internal
   */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_transfer_hook.json');
    this._program = new AnchorProgram({ ...idl as any, address: this.hookProgramId.toBase58() }, this.provider) as any;
    return this._program;
  }
}
