import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the Insurance Vault feature (SSS-151).
 *
 * When set in `StablecoinConfig.feature_flags`, an insurance vault is
 * required before minting is permitted.
 *
 * Matches `FLAG_INSURANCE_VAULT_REQUIRED` in the Anchor program.
 */
export const FLAG_INSURANCE_VAULT_REQUIRED = 1n << 21n; // 0x200000

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `initInsuranceVault`.
 */
export interface InitInsuranceVaultParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The collateral token account that will hold insurance reserves. */
  vaultTokenAccount: PublicKey;
  /**
   * Minimum seed amount expressed in basis points of total supply.
   * Minting is blocked until this threshold is met.
   */
  minSeedBps: number;
  /**
   * Maximum amount that can be drawn in a single draw event, in basis points
   * of the current vault balance.
   */
  maxDrawPerEventBps: number;
}

/**
 * Parameters for `seedInsuranceVault`.
 */
export interface SeedInsuranceVaultParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Depositor's collateral token account (source). */
  depositorTokenAccount: PublicKey;
  /** Vault token account (destination). */
  vaultTokenAccount: PublicKey;
  /** The collateral mint. */
  collateralMint: PublicKey;
  /** Amount to deposit (in collateral token base units). */
  amount: BN | bigint | number;
  /** Token program for the collateral mint (default: TOKEN_2022_PROGRAM_ID). */
  collateralTokenProgram?: PublicKey;
}

/**
 * Parameters for `replenishInsuranceVault`.
 */
export interface ReplenishInsuranceVaultParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Contributor's collateral token account (source). */
  contributorTokenAccount: PublicKey;
  /** Vault token account (destination). */
  vaultTokenAccount: PublicKey;
  /** The collateral mint. */
  collateralMint: PublicKey;
  /** Amount to replenish (in collateral token base units). */
  amount: BN | bigint | number;
  /** Token program for the collateral mint (default: TOKEN_2022_PROGRAM_ID). */
  collateralTokenProgram?: PublicKey;
}

/**
 * Parameters for `drawInsurance`.
 */
export interface DrawInsuranceParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Vault token account (source). */
  vaultTokenAccount: PublicKey;
  /** Destination token account (reserve vault or recovery account). */
  destinationTokenAccount: PublicKey;
  /** The collateral mint. */
  collateralMint: PublicKey;
  /** Amount to draw (in collateral token base units). */
  amount: BN | bigint | number;
  /**
   * 32-byte SHA-256 hash of the human-readable draw reason string.
   * Used for audit trails and replay prevention.
   */
  reasonHash: number[] | Uint8Array;
  /**
   * Optional DAO proposal account.  Required when FLAG_DAO_COMMITTEE is
   * active; must be an executed DrawInsurance proposal with
   * `approved_amount >= amount`.
   */
  daoProposal?: PublicKey;
  /** Token program for the collateral mint (default: TOKEN_2022_PROGRAM_ID). */
  collateralTokenProgram?: PublicKey;
}

// ─── InsuranceVaultModule ─────────────────────────────────────────────────────

/**
 * InsuranceVaultModule — SDK client for the SSS Insurance Vault feature
 * (SSS-151).
 *
 * Wraps `init_insurance_vault`, `seed_insurance_vault`,
 * `replenish_insurance_vault`, and `draw_insurance` Anchor instructions.
 *
 * ## Workflow
 * 1. Admin calls `initInsuranceVault` to create the vault PDA and set
 *    `FLAG_INSURANCE_VAULT_REQUIRED`.
 * 2. Anyone (typically the issuer) calls `seedInsuranceVault` to deposit
 *    collateral until the `min_seed_bps` threshold is reached, unlocking
 *    minting.
 * 3. After a governance-approved draw event, anyone may call
 *    `replenishInsuranceVault` to top the vault back up.
 * 4. Governance (authority ± DAO proposal) calls `drawInsurance` to
 *    transfer funds out of the vault to a recovery account.
 *
 * @example
 * ```ts
 * import { InsuranceVaultModule } from '@sss/sdk';
 *
 * const iv = new InsuranceVaultModule(provider, programId);
 *
 * // 1. Initialise
 * await iv.initInsuranceVault({
 *   mint,
 *   vaultTokenAccount,
 *   minSeedBps: 500,          // 5%
 *   maxDrawPerEventBps: 1000, // 10%
 * });
 *
 * // 2. Seed
 * await iv.seedInsuranceVault({
 *   mint, depositorTokenAccount, vaultTokenAccount, collateralMint,
 *   amount: new BN(1_000_000),
 * });
 *
 * // 3. Draw (governance-controlled)
 * await iv.drawInsurance({
 *   mint, vaultTokenAccount, destinationTokenAccount, collateralMint,
 *   amount: new BN(50_000),
 *   reasonHash: Array.from(sha256("Protocol loss — event #42")),
 * });
 *
 * // 4. Replenish
 * await iv.replenishInsuranceVault({
 *   mint, contributorTokenAccount, vaultTokenAccount, collateralMint,
 *   amount: new BN(50_000),
 * });
 * ```
 */
export class InsuranceVaultModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly INSURANCE_VAULT_SEED = Buffer.from('insurance-vault');

  /**
   * @param provider   Anchor provider (wallet must have appropriate authority).
   * @param programId  SSS token program ID.
   */
  constructor(provider: AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    this.programId = programId;
  }

  // ─── PDA helpers ──────────────────────────────────────────────────────────

  /**
   * Derive the `StablecoinConfig` PDA for the given mint.
   *
   * Seeds: `[b"stablecoin-config", sss_mint]`
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [InsuranceVaultModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `InsuranceVault` PDA for the given mint.
   *
   * Seeds: `[b"insurance-vault", sss_mint]`
   *
   * The same PDA is used both for the on-chain `InsuranceVault` account
   * and as the vault_authority that signs transfers out of the token account.
   */
  getInsuranceVaultPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [InsuranceVaultModule.INSURANCE_VAULT_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

  /**
   * Initialise the InsuranceVault PDA for this mint and enable
   * `FLAG_INSURANCE_VAULT_REQUIRED`.
   *
   * Calls `init_insurance_vault` on the SSS token program.
   * The wallet in `provider` must be the admin authority of the
   * `StablecoinConfig`.
   *
   * @param params  `{ mint, vaultTokenAccount, minSeedBps, maxDrawPerEventBps }`
   * @returns       Transaction signature.
   */
  async initInsuranceVault(params: InitInsuranceVaultParams): Promise<TransactionSignature> {
    const { mint, vaultTokenAccount, minSeedBps, maxDrawPerEventBps } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [insuranceVault] = this.getInsuranceVaultPda(mint);

    return program.methods
      .initInsuranceVault(minSeedBps, maxDrawPerEventBps)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        vaultTokenAccount,
        insuranceVault,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Deposit collateral into the insurance vault.
   *
   * Permissionless — anyone may call this to help the issuer reach the
   * `min_seed_bps` threshold (required before minting is allowed).
   *
   * Calls `seed_insurance_vault` on the SSS token program.
   *
   * @param params  `{ mint, depositorTokenAccount, vaultTokenAccount, collateralMint, amount }`
   * @returns       Transaction signature.
   */
  async seedInsuranceVault(params: SeedInsuranceVaultParams): Promise<TransactionSignature> {
    const {
      mint,
      depositorTokenAccount,
      vaultTokenAccount,
      collateralMint,
      amount,
      collateralTokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [insuranceVault] = this.getInsuranceVaultPda(mint);

    return program.methods
      .seedInsuranceVault(this._toBN(amount))
      .accounts({
        depositor: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        insuranceVault,
        depositorTokenAccount,
        vaultTokenAccount,
        collateralMint,
        collateralTokenProgram,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Replenish the insurance vault after a draw event.
   *
   * Permissionless — anyone may call this to restore the vault balance.
   *
   * Calls `replenish_insurance_vault` on the SSS token program.
   *
   * @param params  `{ mint, contributorTokenAccount, vaultTokenAccount, collateralMint, amount }`
   * @returns       Transaction signature.
   */
  async replenishInsuranceVault(
    params: ReplenishInsuranceVaultParams
  ): Promise<TransactionSignature> {
    const {
      mint,
      contributorTokenAccount,
      vaultTokenAccount,
      collateralMint,
      amount,
      collateralTokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [insuranceVault] = this.getInsuranceVaultPda(mint);

    return program.methods
      .replenishInsuranceVault(this._toBN(amount))
      .accounts({
        contributor: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        insuranceVault,
        contributorTokenAccount,
        vaultTokenAccount,
        collateralMint,
        collateralTokenProgram,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Draw from the insurance vault to cover protocol losses.
   *
   * Governance-controlled: requires authority (+ DAO quorum when
   * `FLAG_DAO_COMMITTEE` is active).  The `daoProposal` account is
   * **required** when the DAO Committee flag is set.
   *
   * Calls `draw_insurance` on the SSS token program.
   *
   * @param params  `{ mint, vaultTokenAccount, destinationTokenAccount, collateralMint, amount, reasonHash, daoProposal? }`
   * @returns       Transaction signature.
   */
  async drawInsurance(params: DrawInsuranceParams): Promise<TransactionSignature> {
    const {
      mint,
      vaultTokenAccount,
      destinationTokenAccount,
      collateralMint,
      amount,
      reasonHash,
      daoProposal,
      collateralTokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [insuranceVault] = this.getInsuranceVaultPda(mint);
    // vault_authority uses the same seeds as insurance_vault
    const [vaultAuthority] = this.getInsuranceVaultPda(mint);

    const reasonHashArray = Array.from(reasonHash);
    if (reasonHashArray.length !== 32) {
      throw new Error(
        `reasonHash must be exactly 32 bytes, got ${reasonHashArray.length}`
      );
    }

    const remainingAccounts = daoProposal
      ? [{ pubkey: daoProposal, isSigner: false, isWritable: true }]
      : [];

    return program.methods
      .drawInsurance(this._toBN(amount), reasonHashArray)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        insuranceVault,
        vaultTokenAccount,
        destinationTokenAccount,
        collateralMint,
        vaultAuthority,
        collateralTokenProgram,
      })
      .remainingAccounts(remainingAccounts)
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** Convert a bigint / number / BN to a Anchor BN. @internal */
  private _toBN(value: BN | bigint | number): BN {
    if (value instanceof BN) return value;
    return new BN(value.toString());
  }

  /** Lazy-load + cache the Anchor program instance. @internal */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    this._program = new AnchorProgram(
      { ...(idl as any), address: this.programId.toBase58() },
      this.provider
    ) as any;
    return this._program;
  }
}
