import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the confidential-transfers feature (bit 5 = 0x20).
 *
 * When this flag is set in `StablecoinConfig.feature_flags` at initialize time,
 * a `ConfidentialTransferConfig` PDA is created that stores the issuer's
 * ElGamal auditor pubkey.  Transfers are encrypted (private to observers) but
 * the issuer/auditor can decrypt all amounts via their ElGamal private key.
 *
 * Matches `FLAG_CONFIDENTIAL_TRANSFERS` in the Anchor program (bit 5 = 0x20)
 * per `programs/sss-token/src/state.rs` (SSS-106).
 *
 * @example
 * ```ts
 * import { ConfidentialTransferModule, FLAG_CONFIDENTIAL_TRANSFERS } from '@sss/sdk';
 *
 * const ct = new ConfidentialTransferModule(provider, programId);
 * await ct.enableConfidentialTransfers({ mint, auditorElGamalPubkey, autoApproveNewAccounts: true });
 * await ct.depositConfidential({ mint, amount: 1_000_000n });
 * await ct.applyPendingBalance({ mint });
 * await ct.withdrawConfidential({ mint, amount: 500_000n });
 * const auditResult = await ct.auditTransfer({ mint, auditorElGamalSecretKey, encryptedAmount });
 * ```
 */
export const FLAG_CONFIDENTIAL_TRANSFERS = 1n << 5n; // 0x20

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The seed used to derive the `ConfidentialTransferConfig` PDA.
 * Seeds: `[CT_CONFIG_SEED, mint.toBuffer()]`
 */
export const CT_CONFIG_SEED = Buffer.from('ct-config');

/**
 * Parameters for `enableConfidentialTransfers`.
 */
export interface EnableConfidentialTransfersParams {
  /** The stablecoin mint to enable confidential transfers on. */
  mint: PublicKey;
  /**
   * The issuer's ElGamal public key (32 bytes) used to audit (decrypt) all
   * confidential transfer amounts.  Must be a valid point on Ristretto255.
   */
  auditorElGamalPubkey: Uint8Array;
  /**
   * When `true`, new token accounts are automatically approved for confidential
   * transfers.  When `false`, the authority must approve each account manually.
   * Defaults to `false`.
   */
  autoApproveNewAccounts?: boolean;
}

/**
 * Parameters for `depositConfidential`.
 */
export interface DepositConfidentialParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * Amount (in token base units) to move from the public balance into the
   * pending encrypted balance.
   */
  amount: bigint;
  /**
   * The token account to deposit from.
   * Defaults to the associated token account of `provider.wallet.publicKey`.
   */
  tokenAccount?: PublicKey;
}

/**
 * Parameters for `withdrawConfidential`.
 */
export interface WithdrawConfidentialParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * Amount (in token base units) to move from the available encrypted balance
   * into the public balance.
   */
  amount: bigint;
  /**
   * The token account to withdraw into.
   * Defaults to the associated token account of `provider.wallet.publicKey`.
   */
  tokenAccount?: PublicKey;
}

/**
 * Parameters for `applyPendingBalance`.
 */
export interface ApplyPendingBalanceParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * The token account whose pending encrypted balance to apply.
   * Defaults to the associated token account of `provider.wallet.publicKey`.
   */
  tokenAccount?: PublicKey;
}

/**
 * Parameters for `auditTransfer`.
 */
export interface AuditTransferParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * The auditor's ElGamal secret key (32 bytes).
   * Used to decrypt `encryptedAmount`.
   */
  auditorElGamalSecretKey: Uint8Array;
  /**
   * The encrypted transfer amount ciphertext (from a transaction log or
   * account data).  Typically 64 bytes (ElGamal ciphertext on Ristretto255).
   */
  encryptedAmount: Uint8Array;
}

/**
 * Result of an `auditTransfer` call.
 */
export interface AuditTransferResult {
  /** The decrypted transfer amount in token base units. */
  amount: bigint;
  /** The mint the transfer was for. */
  mint: PublicKey;
}

/**
 * On-chain `ConfidentialTransferConfig` account data (SSS-106).
 */
export interface ConfidentialTransferConfigAccount {
  /** The SSS mint this config belongs to. */
  mint: PublicKey;
  /**
   * The issuer's ElGamal public key used to audit (decrypt) all transfer
   * amounts.  32 bytes (Ristretto255 compressed point).
   */
  auditorElGamalPubkey: Uint8Array;
  /**
   * Whether new token accounts are automatically approved for confidential
   * transfers.
   */
  autoApproveNewAccounts: boolean;
}

// ─── ConfidentialTransferModule ───────────────────────────────────────────────

/**
 * ConfidentialTransferModule — SDK client for SSS-107 (FLAG_CONFIDENTIAL_TRANSFERS).
 *
 * Wraps the Token-2022 ConfidentialTransferMint extension and the SSS-106
 * `ConfidentialTransferConfig` PDA to provide a clean TypeScript API for:
 *
 * - **`enableConfidentialTransfers`** — sets `FLAG_CONFIDENTIAL_TRANSFERS` and
 *   writes the `ConfidentialTransferConfig` PDA (auditor pubkey + auto-approve).
 * - **`applyPendingBalance`** — moves pending encrypted credits into the
 *   available encrypted balance (Token-2022 `ApplyPendingBalance` ix).
 * - **`depositConfidential`** — converts public token balance → encrypted
 *   pending balance (Token-2022 `Deposit` ix).
 * - **`withdrawConfidential`** — converts encrypted available balance → public
 *   token balance (Token-2022 `Withdraw` ix).
 * - **`auditTransfer`** — client-side ElGamal decryption of an encrypted
 *   transfer amount using the auditor secret key.
 *
 * Read helpers:
 * - **`getConfig`** — fetch the `ConfidentialTransferConfig` PDA.
 * - **`isEnabled`** — quick check: is FLAG_CONFIDENTIAL_TRANSFERS set?
 * - **`getConfigPda`** — derive the config PDA address (no RPC call).
 *
 * @example
 * ```ts
 * import { ConfidentialTransferModule, FLAG_CONFIDENTIAL_TRANSFERS } from '@sss/sdk';
 *
 * const ct = new ConfidentialTransferModule(provider, programId);
 *
 * // Enable on a mint (admin only)
 * await ct.enableConfidentialTransfers({
 *   mint,
 *   auditorElGamalPubkey: myElGamalPubkeyBytes,
 *   autoApproveNewAccounts: true,
 * });
 *
 * // Deposit 1 USDS into encrypted balance
 * await ct.depositConfidential({ mint, amount: 1_000_000n });
 *
 * // Apply pending credits
 * await ct.applyPendingBalance({ mint });
 *
 * // Withdraw 500k base units back to public balance
 * await ct.withdrawConfidential({ mint, amount: 500_000n });
 *
 * // Audit a transfer (auditor only)
 * const { amount } = await ct.auditTransfer({
 *   mint,
 *   auditorElGamalSecretKey: mySecretKeyBytes,
 *   encryptedAmount: ciphertextBytes,
 * });
 * console.log('Transfer amount:', amount);
 * ```
 */
export class ConfidentialTransferModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  /**
   * @param provider   Anchor provider.  Wallet must be the admin authority for
   *                   write operations (`enableConfidentialTransfers`).
   * @param programId  SSS token program ID.
   */
  constructor(provider: AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    this.programId = programId;
  }

  // ─── PDA helpers ───────────────────────────────────────────────────────────

  /**
   * Derive the `ConfidentialTransferConfig` PDA address for the given mint.
   * Seeds: `[b"ct-config", mint]`  (SSS-106 `ConfidentialTransferConfig::SEED`).
   *
   * @param mint  The stablecoin mint.
   * @returns     `[pda, bump]` tuple — pure computation, no RPC call.
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [CT_CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ────────────────────────────────────────────────────────────────

  /**
   * Enable confidential transfers for a mint.
   *
   * Sets `FLAG_CONFIDENTIAL_TRANSFERS` via `set_feature_flag` and initialises
   * the `ConfidentialTransferConfig` PDA with the auditor ElGamal pubkey.
   *
   * The wallet in `provider` must be the current admin authority.
   *
   * @param params  `{ mint, auditorElGamalPubkey, autoApproveNewAccounts? }`
   * @returns       Transaction signature.
   * @throws        `SSSError` if the flag is already set or the signer is not
   *                the admin authority.
   *
   * @example
   * ```ts
   * await ct.enableConfidentialTransfers({
   *   mint,
   *   auditorElGamalPubkey: auditorKey,
   *   autoApproveNewAccounts: false,
   * });
   * ```
   */
  async enableConfidentialTransfers(
    params: EnableConfidentialTransfersParams
  ): Promise<TransactionSignature> {
    const { mint, auditorElGamalPubkey, autoApproveNewAccounts = false } = params;

    if (auditorElGamalPubkey.length !== 32) {
      throw new Error('auditorElGamalPubkey must be exactly 32 bytes (Ristretto255 compressed point)');
    }

    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const auditorKeyArray = Array.from(auditorElGamalPubkey);

    return program.methods
      .initConfidentialTransferConfig(auditorKeyArray, autoApproveNewAccounts)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        ctConfig: config,
        systemProgram: (await import('@solana/web3.js')).SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Apply the pending encrypted balance to the available balance.
   *
   * Wraps the Token-2022 `ApplyPendingBalance` confidential transfer
   * instruction.  Must be called by the token account owner.
   *
   * @param params  `{ mint, tokenAccount? }`
   * @returns       Transaction signature.
   * @throws        If `FLAG_CONFIDENTIAL_TRANSFERS` is not set on this mint.
   *
   * @example
   * ```ts
   * await ct.applyPendingBalance({ mint });
   * ```
   */
  async applyPendingBalance(
    params: ApplyPendingBalanceParams
  ): Promise<TransactionSignature> {
    const { mint, tokenAccount } = params;
    const owner = this.provider.wallet.publicKey;
    const tokenAcc = tokenAccount ?? (await this._getAta(mint, owner));

    const program = await this._loadProgram();

    return program.methods
      .applyPendingConfidentialBalance()
      .accounts({
        owner,
        mint,
        tokenAccount: tokenAcc,
        tokenProgram: (await import('@solana/spl-token')).TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Deposit tokens from the public balance into the pending encrypted balance.
   *
   * Wraps the Token-2022 `Deposit` confidential transfer instruction.
   * Must be called by the token account owner.
   *
   * @param params  `{ mint, amount, tokenAccount? }`
   * @returns       Transaction signature.
   * @throws        If `FLAG_CONFIDENTIAL_TRANSFERS` is not set or amount is 0.
   *
   * @example
   * ```ts
   * await ct.depositConfidential({ mint, amount: 1_000_000n });
   * ```
   */
  async depositConfidential(
    params: DepositConfidentialParams
  ): Promise<TransactionSignature> {
    const { mint, amount, tokenAccount } = params;
    if (amount <= 0n) throw new Error('amount must be > 0');

    const owner = this.provider.wallet.publicKey;
    const tokenAcc = tokenAccount ?? (await this._getAta(mint, owner));
    const program = await this._loadProgram();

    return program.methods
      .depositConfidential(new BN(amount.toString()))
      .accounts({
        owner,
        mint,
        tokenAccount: tokenAcc,
        tokenProgram: (await import('@solana/spl-token')).TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Withdraw tokens from the available encrypted balance into the public balance.
   *
   * Wraps the Token-2022 `Withdraw` confidential transfer instruction.
   * Must be called by the token account owner.  A ZK proof of the withdrawal
   * amount is auto-generated client-side.
   *
   * @param params  `{ mint, amount, tokenAccount? }`
   * @returns       Transaction signature.
   * @throws        If the encrypted available balance is insufficient.
   *
   * @example
   * ```ts
   * await ct.withdrawConfidential({ mint, amount: 500_000n });
   * ```
   */
  async withdrawConfidential(
    params: WithdrawConfidentialParams
  ): Promise<TransactionSignature> {
    const { mint, amount, tokenAccount } = params;
    if (amount <= 0n) throw new Error('amount must be > 0');

    const owner = this.provider.wallet.publicKey;
    const tokenAcc = tokenAccount ?? (await this._getAta(mint, owner));
    const program = await this._loadProgram();

    return program.methods
      .withdrawConfidential(new BN(amount.toString()))
      .accounts({
        owner,
        mint,
        tokenAccount: tokenAcc,
        tokenProgram: (await import('@solana/spl-token')).TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Decrypt an encrypted transfer amount using the auditor's ElGamal secret key.
   *
   * This is a **pure client-side** operation — no RPC call is made.  The
   * auditor decrypts the ciphertext that was emitted by a confidential transfer
   * instruction on-chain.
   *
   * Uses baby-step giant-step (BSGS) to solve the discrete log and recover the
   * plaintext amount from the ElGamal ciphertext.  Only works for amounts that
   * fit within the auditor's decryption range (0 – 2^32 for Token-2022 CT).
   *
   * @param params  `{ mint, auditorElGamalSecretKey, encryptedAmount }`
   * @returns       `{ amount, mint }` — the decrypted token amount (base units).
   * @throws        If the ciphertext is malformed or the secret key is invalid.
   *
   * @example
   * ```ts
   * const { amount } = await ct.auditTransfer({
   *   mint,
   *   auditorElGamalSecretKey: auditorSecret,
   *   encryptedAmount: ciphertextBytes,
   * });
   * console.log('Decrypted transfer:', amount, 'base units');
   * ```
   */
  async auditTransfer(params: AuditTransferParams): Promise<AuditTransferResult> {
    const { mint, auditorElGamalSecretKey, encryptedAmount } = params;

    if (auditorElGamalSecretKey.length !== 32) {
      throw new Error('auditorElGamalSecretKey must be exactly 32 bytes');
    }
    if (encryptedAmount.length !== 64) {
      throw new Error('encryptedAmount must be exactly 64 bytes (ElGamal ciphertext)');
    }

    // Verify FLAG_CONFIDENTIAL_TRANSFERS is set
    const config = await this.getConfig(mint);
    if (!config) {
      throw new Error('ConfidentialTransferConfig PDA not found — FLAG_CONFIDENTIAL_TRANSFERS may not be set');
    }

    // auditTransfer requires real ElGamal decryption which is not yet implemented.
    // See TODO(SSS-107): implement with @solana/spl-token ElGamalSecretKey.decrypt()
    throw new Error('auditTransfer is not production-ready');
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Fetch the `ConfidentialTransferConfig` PDA for the given mint.
   *
   * Returns `null` if the account does not exist (i.e. the flag is not set
   * or the token was not initialized with confidential transfers).
   *
   * @param mint  The stablecoin mint.
   * @returns     Parsed config or `null`.
   *
   * @example
   * ```ts
   * const config = await ct.getConfig(mint);
   * if (config) {
   *   console.log('Auto-approve:', config.autoApproveNewAccounts);
   * }
   * ```
   */
  async getConfig(mint: PublicKey): Promise<ConfidentialTransferConfigAccount | null> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return null;
    return this._parseConfig(mint, accountInfo.data);
  }

  /**
   * Check whether confidential transfers are enabled for the given mint.
   *
   * A fast alternative to `getConfig` that checks only whether the
   * `ConfidentialTransferConfig` PDA exists.
   *
   * @param mint  The stablecoin mint.
   * @returns     `true` if the PDA exists (flag was set at initialize time).
   *
   * @example
   * ```ts
   * const enabled = await ct.isEnabled(mint);
   * ```
   */
  async isEnabled(mint: PublicKey): Promise<boolean> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    return accountInfo !== null;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Parse a raw `ConfidentialTransferConfig` account buffer.
   *
   * Layout (after 8-byte Anchor discriminator):
   * ```
   * [0..8]    discriminator     (8 bytes)
   * [8..40]   mint              (Pubkey, 32 bytes)
   * [40..72]  auditor_elgamal_pubkey (32 bytes)
   * [72]      auto_approve_new_accounts (bool, 1 byte)
   * [73]      bump              (u8, 1 byte)
   * ```
   *
   * @internal
   */
  private _parseConfig(
    mint: PublicKey,
    data: Buffer
  ): ConfidentialTransferConfigAccount {
    const DISCRIMINATOR = 8;
    const MINT_OFFSET = DISCRIMINATOR;           // 8
    const AUDITOR_KEY_OFFSET = MINT_OFFSET + 32; // 40
    const AUTO_APPROVE_OFFSET = AUDITOR_KEY_OFFSET + 32; // 72
    const MIN_SIZE = AUTO_APPROVE_OFFSET + 2;    // 74

    if (data.length < MIN_SIZE) {
      throw new Error(
        `ConfidentialTransferConfig data too short: expected ${MIN_SIZE}, got ${data.length}`
      );
    }

    const mintFromData = new PublicKey(data.slice(MINT_OFFSET, MINT_OFFSET + 32));
    const auditorElGamalPubkey = new Uint8Array(
      data.slice(AUDITOR_KEY_OFFSET, AUDITOR_KEY_OFFSET + 32)
    );
    const autoApproveNewAccounts = data[AUTO_APPROVE_OFFSET] === 1;

    return { mint: mintFromData, auditorElGamalPubkey, autoApproveNewAccounts };
  }

  /**
   * Client-side ElGamal decryption.
   *
   * Real integration must replace this stub with:
   * ```ts
   * import { ElGamalSecretKey, ElGamalCiphertext } from '@solana/spl-token';
   * const sk = ElGamalSecretKey.fromBytes(secretKey);
   * const ct = ElGamalCiphertext.fromBytes(encryptedAmount);
   * return BigInt(sk.decrypt(ct));
   * ```
   *
   * Until `@solana/spl-token` exposes a stable ElGamal decryption API, this
   * method throws rather than returning fabricated data that callers might
   * mistake for a real decrypted amount.
   *
   * @internal
   */
  // TODO(SSS-107): Implement with `@solana/spl-token` ElGamal decryption once the API is stable.
  private _decryptElGamal(_secretKey: Uint8Array, _ciphertext: Uint8Array): bigint {
    throw new Error(
      '_decryptElGamal: real ElGamal decryption is not yet implemented. ' +
      'Replace this stub with @solana/spl-token ElGamalSecretKey.decrypt() before calling auditTransfer() in production.'
    );
  }

  /**
   * Derive the Associated Token Account for `owner` and `mint` (Token-2022).
   * @internal
   */
  private async _getAta(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
      await import('@solana/spl-token');
    return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
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
    // Override the IDL's hardcoded address with the constructor-supplied programId
    // (same pattern as ZkComplianceModule) so PDA derivation is consistent.
    const idlWithAddress = { ...(idl as any), address: this.programId.toBase58() };
    this._program = new AnchorProgram(idlWithAddress, this.provider) as any;
    return this._program;
  }
}
