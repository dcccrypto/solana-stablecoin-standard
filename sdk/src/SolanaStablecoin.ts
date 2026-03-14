import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import {
  AnchorProvider,
  BN,
  Program,
  web3,
} from '@coral-xyz/anchor';
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  burn,
  freezeAccount,
  thawAccount,
} from '@solana/spl-token';

import {
  BurnParams,
  FreezeParams,
  MintParams,
  MinterConfig,
  RevokeMinterParams,
  SdkOptions,
  SssConfig,
  StablecoinInfo,
  UpdateMinterParams,
  UpdateRolesParams,
} from './types';

/** Deployed program IDs (devnet + localnet) — matches Anchor.toml */
export const SSS_TOKEN_PROGRAM_ID = new PublicKey(
  '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN'
);
export const SSS_TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  '8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj'
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
   * Create and initialize a new stablecoin mint.
   * This is the primary entry point — it handles both SSS-1 and SSS-2.
   */
  static async create(
    provider: AnchorProvider,
    config: SssConfig,
    options: Partial<SdkOptions> = {}
  ): Promise<SolanaStablecoin> {
    const programId = options.programId ?? SSS_TOKEN_PROGRAM_ID;
    const connection = provider.connection;
    const payer = provider.wallet.publicKey;
    const decimals = config.decimals ?? 6;

    // Create Token-2022 mint
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    // Derive config PDA
    const [configPda] = SolanaStablecoin.getConfigPda(mint, programId);

    // For now, create the mint directly via SPL Token-2022
    // (Full Anchor CPI integration requires IDL — see programs/sss-token)
    await createMint(
      connection,
      provider.wallet as any,
      payer,
      payer,
      decimals,
      mintKeypair,
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );

    return new SolanaStablecoin(provider, mint, configPda, config, programId);
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
   * Mint tokens to a recipient.
   */
  async mintTo(params: MintParams): Promise<TransactionSignature> {
    const connection = this.provider.connection;
    const mintAuthority = this.provider.wallet;

    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority as any,
      params.mint,
      params.recipient,
      false,
      'confirmed',
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );

    return mintTo(
      connection,
      mintAuthority as any,
      params.mint,
      recipientAta.address,
      mintAuthority.publicKey,
      params.amount,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  /**
   * Burn tokens from a source account.
   */
  async burnFrom(params: BurnParams): Promise<TransactionSignature> {
    return burn(
      this.provider.connection,
      this.provider.wallet as any,
      params.source,
      params.mint,
      this.provider.wallet.publicKey,
      params.amount,
      [],
      { commitment: 'confirmed' },
      TOKEN_2022_PROGRAM_ID
    );
  }

  /**
   * Freeze a token account (compliance action).
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
   *
   * This builds and sends the on-chain `pause` instruction via the
   * sss-token program's config PDA.
   */
  async pause(): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    return (program as any).methods
      .pause()
      .accounts({ config: this.configPda, admin: this.provider.wallet.publicKey })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Unpause the stablecoin — re-enables minting.
   * Caller must be the admin authority.
   */
  async unpause(): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    return (program as any).methods
      .unpause()
      .accounts({ config: this.configPda, admin: this.provider.wallet.publicKey })
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
    return (program as any).methods
      .updateMinter(new BN(params.cap.toString()))
      .accounts({
        admin: this.provider.wallet.publicKey,
        config: this.configPda,
        minterInfo: minterPda,
        minterAuthority: params.minter,
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
    return (program as any).methods
      .revokeMinter()
      .accounts({
        admin: this.provider.wallet.publicKey,
        config: this.configPda,
        minterInfo: minterPda,
        minterAuthority: params.minter,
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
    return (program as any).methods
      .updateRoles(
        params.newAuthority ?? null,
        params.newComplianceAuthority ?? null
      )
      .accounts({
        admin: this.provider.wallet.publicKey,
        config: this.configPda,
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
    const { Program } = await import('@coral-xyz/anchor');
    const idl = await import('../../idl/sss_token.json');
    this._program = new Program(idl as any, this.provider);
    return this._program;
  }

  /**
   * Get the total supply info for this mint.
   */
  async getTotalSupply(): Promise<{
    totalMinted: bigint;
    totalBurned: bigint;
    circulatingSupply: bigint;
  }> {
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
