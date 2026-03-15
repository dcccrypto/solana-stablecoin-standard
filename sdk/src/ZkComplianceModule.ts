import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the ZK Compliance feature (SSS-075 / SSS-076).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, every transfer
 * requires the sender to hold a valid `VerificationRecord` PDA that has not
 * expired.
 *
 * Matches `FLAG_ZK_COMPLIANCE` in the Anchor program (bit 4 = 0x10).
 *
 * @example
 * ```ts
 * const active = await featureFlags.isFeatureFlagSet(mint, FLAG_ZK_COMPLIANCE);
 * ```
 */
export const FLAG_ZK_COMPLIANCE = 1n << 4n; // 0x10

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `initZkCompliance`.
 */
export interface InitZkComplianceParams {
  /** The stablecoin mint (must be SSS-2 preset). */
  mint: PublicKey;
  /**
   * Number of slots a submitted proof remains valid.
   * Pass `0` to use the on-chain default (1500 slots ≈ 10 minutes at 400ms/slot).
   */
  ttlSlots?: number;
}

/**
 * Parameters for `submitZkProof`.
 */
export interface SubmitZkProofParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * The user whose `VerificationRecord` PDA will be created or refreshed.
   * Defaults to `provider.wallet.publicKey` when omitted.
   */
  user?: PublicKey;
}

/**
 * Parameters for `closeVerificationRecord`.
 */
export interface CloseVerificationRecordParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The wallet whose expired `VerificationRecord` should be closed. */
  recordOwner: PublicKey;
}

/**
 * Parameters for `executeCompliantTransfer`.
 */
export interface ExecuteCompliantTransferParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Source token account. */
  source: PublicKey;
  /** Destination token account. */
  destination: PublicKey;
  /** Token amount (in smallest units). */
  amount: bigint;
  /**
   * Whether to verify the caller's VerificationRecord is still valid
   * client-side before sending.  Default `true`.
   */
  preflight?: boolean;
}

/**
 * Decoded on-chain `ZkComplianceConfig` account data.
 */
export interface ZkComplianceConfigAccount {
  /** The mint this config belongs to. */
  sssMint: PublicKey;
  /** Number of slots a submitted proof remains valid. */
  ttlSlots: bigint;
  /** Bump seed. */
  bump: number;
}

/**
 * Decoded on-chain `VerificationRecord` account data.
 */
export interface VerificationRecordAccount {
  /** The mint this record is scoped to. */
  sssMint: PublicKey;
  /** The wallet that submitted the proof. */
  user: PublicKey;
  /** The slot at which this record expires (exclusive). */
  expiresAtSlot: bigint;
  /** Bump seed. */
  bump: number;
}

// ─── ZkComplianceModule ───────────────────────────────────────────────────────

/**
 * ZkComplianceModule — SDK client for the SSS ZK Compliance feature (SSS-076).
 *
 * Wraps `init_zk_compliance`, `submit_zk_proof`, and `close_verification_record`
 * Anchor instructions, and provides `executeCompliantTransfer` as a client-side
 * helper that performs a preflight check before dispatching a Token-2022 transfer.
 *
 * **ZK Compliance pattern**: call `submitZkProof` for users that have cleared
 * off-chain compliance checks. The resulting `VerificationRecord` PDA is
 * checked by the transfer hook on every transfer when `FLAG_ZK_COMPLIANCE` is set.
 * Records expire after `ttlSlots` and must be refreshed.
 *
 * @example
 * ```ts
 * import { ZkComplianceModule, FLAG_ZK_COMPLIANCE } from '@sss/sdk';
 *
 * const zk = new ZkComplianceModule(provider, programId);
 *
 * // Initialize (authority, SSS-2 only)
 * await zk.initZkCompliance({ mint, ttlSlots: 1500 });
 *
 * // Submit proof on behalf of a user (after off-chain verification)
 * await zk.submitZkProof({ mint, user: userPubkey });
 *
 * // Check if a record is still valid
 * const valid = await zk.isVerificationValid(mint, userPubkey);
 *
 * // Fetch the record details
 * const record = await zk.fetchVerificationRecord(mint, userPubkey);
 * ```
 */
export class ZkComplianceModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED       = Buffer.from('stablecoin-config');
  static readonly ZK_CONFIG_SEED    = Buffer.from('zk-compliance-config');
  static readonly VERIFICATION_SEED = Buffer.from('zk-verification');

  /**
   * @param provider   Anchor provider (wallet must be the admin authority to
   *                   call `initZkCompliance` or `closeVerificationRecord`).
   * @param programId  SSS token program ID.
   */
  constructor(provider: AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    this.programId = programId;
  }

  // ─── PDA helpers ─────────────────────────────────────────────────────────

  /**
   * Derive the `StablecoinConfig` PDA for the given mint.
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ZkComplianceModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `ZkComplianceConfig` PDA for the given mint.
   * Seeds: `["zk-compliance-config", mint]`
   */
  getZkConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ZkComplianceModule.ZK_CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `VerificationRecord` PDA for a specific (mint, user) pair.
   * Seeds: `["zk-verification", mint, user]`
   */
  getVerificationRecordPda(mint: PublicKey, user: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ZkComplianceModule.VERIFICATION_SEED, mint.toBuffer(), user.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialize the `ZkComplianceConfig` PDA for a stablecoin mint.
   *
   * Atomically enables `FLAG_ZK_COMPLIANCE` on the `StablecoinConfig`.
   * Only valid for SSS-2 (compliant) stablecoins.
   * The wallet in `provider` must be the admin authority.
   *
   * @param params  `{ mint, ttlSlots }` — mint and optional TTL.
   * @returns       Transaction signature.
   * @throws        If the signer is not the admin authority, or mint is not SSS-2.
   */
  async initZkCompliance(params: InitZkComplianceParams): Promise<TransactionSignature> {
    const { mint, ttlSlots = 0 } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [zkComplianceConfig] = this.getZkConfigPda(mint);

    return program.methods
      .initZkCompliance(new BN(ttlSlots))
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        zkComplianceConfig,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Submit or refresh a ZK proof for a user.
   *
   * Creates or updates the `VerificationRecord` PDA with an expiry of
   * `currentSlot + ttlSlots`. In production, this should only be called
   * after the compliance oracle has verified the proof off-chain.
   *
   * Any wallet may call this instruction (user pays rent if creating).
   *
   * @param params  `{ mint, user }` — mint and optional user (defaults to wallet).
   * @returns       Transaction signature.
   */
  async submitZkProof(params: SubmitZkProofParams): Promise<TransactionSignature> {
    const { mint } = params;
    const user = params.user ?? this.provider.wallet.publicKey;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [zkComplianceConfig] = this.getZkConfigPda(mint);
    const [verificationRecord] = this.getVerificationRecordPda(mint, user);

    return program.methods
      .submitZkProof()
      .accounts({
        user: this.provider.wallet.publicKey,
        mint,
        config,
        zkComplianceConfig,
        verificationRecord,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Close an expired `VerificationRecord` PDA, returning rent to authority.
   *
   * Fails if the record has not yet expired.
   * The wallet in `provider` must be the admin authority.
   *
   * @param params  `{ mint, recordOwner }` — mint and wallet whose record to close.
   * @returns       Transaction signature.
   */
  async closeVerificationRecord(
    params: CloseVerificationRecordParams
  ): Promise<TransactionSignature> {
    const { mint, recordOwner } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [verificationRecord] = this.getVerificationRecordPda(mint, recordOwner);

    return program.methods
      .closeVerificationRecord()
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        recordOwner,
        verificationRecord,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Execute a compliant transfer via Token-2022's transfer-checked instruction.
   *
   * When `preflight` is enabled (default), checks the sender's
   * `VerificationRecord` client-side before sending — providing a cleaner
   * error than waiting for the transfer hook to reject the transaction.
   *
   * @param params  Transfer parameters including source, destination, and amount.
   * @returns       Transaction signature.
   * @throws        `SSSError` with code `ZK_RECORD_MISSING` or `ZK_RECORD_EXPIRED`
   *                if preflight fails.
   */
  async executeCompliantTransfer(
    params: ExecuteCompliantTransferParams
  ): Promise<TransactionSignature> {
    const { mint, source, destination, amount, preflight = true } = params;
    const senderWallet = this.provider.wallet.publicKey;

    if (preflight) {
      const valid = await this.isVerificationValid(mint, senderWallet);
      if (!valid) {
        throw new Error(
          `ZkCompliance: VerificationRecord for ${senderWallet.toBase58()} on mint ` +
          `${mint.toBase58()} is missing or expired. Call submitZkProof first.`
        );
      }
    }

    const { transferChecked, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } =
      await import('@solana/spl-token');

    // Fetch decimals from mint account
    const mintInfo = await this.provider.connection.getAccountInfo(mint);
    if (!mintInfo) throw new Error(`Mint account not found: ${mint.toBase58()}`);
    // Token-2022 Mint layout: discriminator(1) + ...decimals at offset 44
    const decimals = mintInfo.data[44];

    return transferChecked(
      this.provider.connection,
      (this.provider.wallet as any).payer ?? (this.provider.wallet as any),
      source,
      mint,
      destination,
      senderWallet,
      Number(amount),
      decimals,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Check whether a user's `VerificationRecord` exists and has not expired.
   *
   * Reads the raw on-chain account and compares `expires_at_slot` to the
   * current slot. Returns `false` if the account does not exist.
   *
   * @param mint  The stablecoin mint.
   * @param user  The wallet to check.
   * @returns     `true` if the record exists and is not expired.
   */
  async isVerificationValid(mint: PublicKey, user: PublicKey): Promise<boolean> {
    const record = await this._fetchRawVerificationRecord(mint, user);
    if (!record) return false;
    const currentSlot = await this.provider.connection.getSlot('finalized');
    return currentSlot < record.expiresAtSlot;
  }

  /**
   * Fetch and decode a `VerificationRecord` account.
   *
   * Returns `null` if the account does not exist.
   *
   * @param mint  The stablecoin mint.
   * @param user  The wallet to look up.
   */
  async fetchVerificationRecord(
    mint: PublicKey,
    user: PublicKey
  ): Promise<VerificationRecordAccount | null> {
    return this._fetchRawVerificationRecord(mint, user);
  }

  /**
   * Fetch and decode a `ZkComplianceConfig` account.
   *
   * Returns `null` if the account has not been initialized.
   *
   * @param mint  The stablecoin mint.
   */
  async fetchZkConfig(mint: PublicKey): Promise<ZkComplianceConfigAccount | null> {
    const [pda] = this.getZkConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return null;
    return this._decodeZkConfig(accountInfo.data);
  }

  /**
   * Read the slots-to-live setting from the on-chain `ZkComplianceConfig`.
   * Returns `null` if the config has not been initialized.
   *
   * @param mint  The stablecoin mint.
   */
  async getTtlSlots(mint: PublicKey): Promise<bigint | null> {
    const config = await this.fetchZkConfig(mint);
    return config?.ttlSlots ?? null;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Parse a `VerificationRecord` from raw account data.
   *
   * Layout (Borsh, after 8-byte Anchor discriminator):
   * ```
   * [0..8]   discriminator  (8 bytes)
   * [8..40]  sss_mint       (Pubkey, 32 bytes)
   * [40..72] user           (Pubkey, 32 bytes)
   * [72..80] expires_at_slot (u64 LE, 8 bytes)
   * [80]     bump           (u8, 1 byte)
   * ```
   * @internal
   */
  private _decodeVerificationRecord(data: Buffer): VerificationRecordAccount {
    const sssMint = new PublicKey(data.subarray(8, 40));
    const user    = new PublicKey(data.subarray(40, 72));
    const expiresAtSlot = data.readBigUInt64LE(72);
    const bump    = data[80];
    return { sssMint, user, expiresAtSlot, bump };
  }

  /**
   * Parse a `ZkComplianceConfig` from raw account data.
   *
   * Layout (Borsh, after 8-byte Anchor discriminator):
   * ```
   * [0..8]   discriminator  (8 bytes)
   * [8..40]  sss_mint       (Pubkey, 32 bytes)
   * [40..48] ttl_slots      (u64 LE, 8 bytes)
   * [48]     bump           (u8, 1 byte)
   * ```
   * @internal
   */
  private _decodeZkConfig(data: Buffer): ZkComplianceConfigAccount {
    const sssMint  = new PublicKey(data.subarray(8, 40));
    const ttlSlots = data.readBigUInt64LE(40);
    const bump     = data[48];
    return { sssMint, ttlSlots, bump };
  }

  /**
   * Fetch and decode a VerificationRecord from on-chain, or return null.
   * @internal
   */
  private async _fetchRawVerificationRecord(
    mint: PublicKey,
    user: PublicKey
  ): Promise<VerificationRecordAccount | null> {
    const [pda] = this.getVerificationRecordPda(mint, user);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo || accountInfo.data.length < 81) return null;
    return this._decodeVerificationRecord(accountInfo.data);
  }

  /**
   * Lazy-load + cache the Anchor program instance.
   * @internal
   */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    this._program = new AnchorProgram(idl as any, this.provider) as any;
    return this._program;
  }
}
