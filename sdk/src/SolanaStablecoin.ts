import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionSignature,
} from '@solana/web3.js';
import {
  AnchorProvider,
  BN,
} from '@coral-xyz/anchor';
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  freezeAccount,
  thawAccount,
} from '@solana/spl-token';

import {
  BurnParams,
  FreezeParams,
  MintParams,
  RevokeMinterParams,
  SdkOptions,
  SssConfig,
  UpdateMinterParams,
  UpdateRolesParams,
} from './types';

/** Deployed program IDs (devnet + localnet) — matches Anchor.toml */
export const SSS_TOKEN_PROGRAM_ID = new PublicKey(
  'AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat'
);
export const SSS_TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  'phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp'
);

const CONFIG_SEED = Buffer.from('stablecoin-config');
const MINTER_SEED = Buffer.from('minter-info');

/**
 * Main SDK class for the Solana Stablecoin Standard.
 *
 * @example SSS-1 (minimal)
 * ```ts
 * const stablecoin = await SolanaStablecoin.create(provider, {
 *   preset: 'SSS-1',
 *   name: 'My Stable',
 *   symbol: 'MST',
 *   decimals: 6,
 * });
 * ```
 *
 * @example SSS-2 (compliant)
 * ```ts
 * const stablecoin = await SolanaStablecoin.create(provider, {
 *   preset: 'SSS-2',
 *   name: 'USD Stable',
 *   symbol: 'USDS',
 *   decimals: 6,
 *   transferHookProgram: hookProgramId,
 * });
 * ```
 */
export class SolanaStablecoin {
  readonly provider: AnchorProvider;
  readonly mint: PublicKey;
  readonly config: SssConfig;
  readonly configPda: PublicKey;
  private readonly programId: PublicKey;

  private constructor(
    provider: AnchorProvider,
    mint: PublicKey,
    configPda: PublicKey,
    config: SssConfig,
    programId: PublicKey
  ) {
    this.provider = provider;
    this.mint = mint;
    this.configPda = configPda;
    this.config = config;
    this.programId = programId;
  }

  /**
   * Derive the config PDA for a given mint.
   */
  static getConfigPda(
    mint: PublicKey,
    programId: PublicKey = SSS_TOKEN_PROGRAM_ID
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [CONFIG_SEED, mint.toBuffer()],
      programId
    );
  }

  /**
   * Derive the minter PDA.
   */
  static getMinterPda(
    configPda: PublicKey,
    minter: PublicKey,
    programId: PublicKey = SSS_TOKEN_PROGRAM_ID
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [MINTER_SEED, configPda.toBuffer(), minter.toBuffer()],
      programId
    );
  }

  /**
   * Create and initialize a new stablecoin mint via the on-chain program.
   *
   * Calls the `initialize` instruction which:
   *  - Creates the Token-2022 mint account
   *  - Initialises the StablecoinConfig PDA
   *  - Stores preset, authorities, decimals, and optional transfer hook
   *
   * This is the primary entry point — it handles both SSS-1 and SSS-2.
   */
  static async create(
    provider: AnchorProvider,
    config: SssConfig,
    options: Partial<SdkOptions> = {}
  ): Promise<SolanaStablecoin> {
    const programId = options.programId ?? SSS_TOKEN_PROGRAM_ID;
    const payer = provider.wallet.publicKey;
    const decimals = config.decimals ?? 6;

    // Generate a fresh mint keypair — passed as a signer to initialize
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    // Derive config PDA
    const [configPda] = SolanaStablecoin.getConfigPda(mint, programId);

    // Load the Anchor program
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    const program = new AnchorProgram(idl as any, provider) as any;

    // Build InitializeParams matching the IDL struct
    const presetNum = config.preset === 'SSS-1' ? 1 : 2;
    const initParams = {
      preset: presetNum,
      decimals,
      name: config.name,
      symbol: config.symbol,
      uri: config.uri ?? '',
      // Anchor JS serializes struct fields using camelCase names matching the
      // generated TypeScript types — use transferHookProgram, not transfer_hook_program.
      transferHookProgram:
        config.preset === 'SSS-2' && config.transferHookProgram
          ? config.transferHookProgram
          : null,
    };

    await program.methods
      .initialize(initParams)
      .accounts({
        payer,
        mint,
        config: configPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc({ commitment: 'confirmed' });

    const instance = new SolanaStablecoin(provider, mint, configPda, config, programId);
    instance._program = program;
    return instance;
  }

  /**
   * Load an existing stablecoin by mint address.
   */
  static async load(
    provider: AnchorProvider,
    mint: PublicKey,
    config: SssConfig,
    options: Partial<SdkOptions> = {}
  ): Promise<SolanaStablecoin> {
    const programId = options.programId ?? SSS_TOKEN_PROGRAM_ID;
    const [configPda] = SolanaStablecoin.getConfigPda(mint, programId);
    return new SolanaStablecoin(provider, mint, configPda, config, programId);
  }

  /**
   * Mint tokens to a recipient via the on-chain `mint` instruction.
   *
   * The caller (provider.wallet) must be a registered minter with sufficient
   * remaining cap. The recipient ATA is created if it does not yet exist.
   */
  async mintTo(params: MintParams): Promise<TransactionSignature> {
    const connection = this.provider.connection;
    const minter = this.provider.wallet.publicKey;

    // Ensure recipient has a Token-2022 ATA
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      this.provider.wallet as any,
      params.mint,
      params.recipient,
      false,
      'confirmed',
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );

    const [configPda] = SolanaStablecoin.getConfigPda(params.mint, this.programId);
    const [minterPda] = SolanaStablecoin.getMinterPda(configPda, minter, this.programId);

    const program = await this._loadProgram();
    return program.methods
      .mint(new BN(params.amount.toString()))
      .accounts({
        minter,
        config: configPda,
        mint: params.mint,
        minterInfo: minterPda,
        recipientTokenAccount: recipientAta.address,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Burn tokens from a source account via the on-chain `burn` instruction.
   *
   * The caller (provider.wallet) must be a registered minter.
   */
  async burnFrom(params: BurnParams): Promise<TransactionSignature> {
    const minter = this.provider.wallet.publicKey;
    const [configPda] = SolanaStablecoin.getConfigPda(params.mint, this.programId);
    const [minterPda] = SolanaStablecoin.getMinterPda(configPda, minter, this.programId);

    const program = await this._loadProgram();
    return program.methods
      .burn(new BN(params.amount.toString()))
      .accounts({
        minter,
        config: configPda,
        mint: params.mint,
        minterInfo: minterPda,
        sourceTokenAccount: params.source,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Freeze a token account (compliance action).
   * Uses the Token-2022 freeze authority (held by the compliance authority).
   */
  async freeze(params: FreezeParams): Promise<TransactionSignature> {
    return freezeAccount(
      this.provider.connection,
      this.provider.wallet as any,
      params.targetTokenAccount,
      params.mint,
      this.provider.wallet.publicKey,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  /**
   * Thaw a frozen token account.
   */
  async thaw(params: FreezeParams): Promise<TransactionSignature> {
    return thawAccount(
      this.provider.connection,
      this.provider.wallet as any,
      params.targetTokenAccount,
      params.mint,
      this.provider.wallet.publicKey,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  /**
   * Pause the stablecoin — rejects all mint operations while paused.
   * Caller must be the admin authority.
   */
  async pause(): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    return program.methods
      .pause()
      .accounts({
        authority: this.provider.wallet.publicKey,
        config: this.configPda,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Unpause the stablecoin — re-enables minting.
   * Caller must be the admin authority.
   */
  async unpause(): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    return program.methods
      .unpause()
      .accounts({
        authority: this.provider.wallet.publicKey,
        config: this.configPda,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Register or update a minter with a cap.
   * Caller must be the admin authority.
   *
   * @param params.minter  - The public key to authorize as a minter.
   * @param params.cap     - Maximum tokens (in base units) this minter may
   *                         mint in total. Pass `0n` for unlimited.
   */
  async updateMinter(params: UpdateMinterParams): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const [minterPda] = SolanaStablecoin.getMinterPda(
      this.configPda,
      params.minter,
      this.programId
    );
    return program.methods
      .updateMinter(new BN(params.cap.toString()))
      .accounts({
        authority: this.provider.wallet.publicKey,
        config: this.configPda,
        mint: this.mint,
        minter: params.minter,
        minterInfo: minterPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Revoke a minter — closes the minter PDA and removes their authorization.
   * Caller must be the admin authority.
   */
  async revokeMinter(params: RevokeMinterParams): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const [minterPda] = SolanaStablecoin.getMinterPda(
      this.configPda,
      params.minter,
      this.programId
    );
    return program.methods
      .revokeMinter()
      .accounts({
        authority: this.provider.wallet.publicKey,
        config: this.configPda,
        mint: this.mint,
        minter: params.minter,
        minterInfo: minterPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Transfer the admin or compliance authority to a new keypair.
   * Caller must be the current admin authority.
   *
   * Pass only the fields you want to update — omitted fields are left unchanged.
   */
  async updateRoles(params: UpdateRolesParams): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    return program.methods
      .updateRoles(
        params.newAuthority ?? null,
        params.newComplianceAuthority ?? null
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        config: this.configPda,
        mint: this.mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Load the Anchor program instance (lazy, cached per instance).
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

  /**
   * Get the total supply info for this mint by reading the on-chain
   * StablecoinConfig PDA.  Falls back to the raw Token-2022 mint supply if
   * the config account does not yet exist (e.g. unit-test environments where
   * the program has not been initialised).
   */
  async getTotalSupply(): Promise<{
    totalMinted: bigint;
    totalBurned: bigint;
    circulatingSupply: bigint;
  }> {
    try {
      const program = await this._loadProgram();
      const configAccount = await program.account.stablecoinConfig.fetch(
        this.configPda
      );
      const totalMinted = BigInt(configAccount.totalMinted.toString());
      const totalBurned = BigInt(configAccount.totalBurned.toString());
      return {
        totalMinted,
        totalBurned,
        circulatingSupply: totalMinted - totalBurned,
      };
    } catch {
      // Fallback: read from the Token-2022 mint account directly
      const conn = this.provider.connection;
      const mintInfo = await conn.getParsedAccountInfo(this.mint);
      if (!mintInfo.value) throw new Error(`Mint ${this.mint} not found`);
      const data = (mintInfo.value.data as any).parsed?.info;
      const supply = BigInt(data?.supply ?? 0);
      return {
        totalMinted: supply,
        totalBurned: 0n,
        circulatingSupply: supply,
      };
    }
  }
}
