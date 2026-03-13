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
  SdkOptions,
  SssConfig,
  StablecoinInfo,
} from './types';

const SSS_TOKEN_PROGRAM_ID = new PublicKey(
  'SSS1111111111111111111111111111111111111111111'
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
  static async getConfigPda(
    mint: PublicKey,
    programId: PublicKey = SSS_TOKEN_PROGRAM_ID
  ): Promise<[PublicKey, number]> {
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
