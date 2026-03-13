import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  getMint,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotent,
  createInitializeMint2Instruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferHookInstruction,
  createSetAuthorityInstruction,
  tokenMetadataInitialize,
  createMint,
  mintTo,
  burn,
  freezeAccount,
  thawAccount,
  AuthorityType,
} from "@solana/spl-token";
import { pause, resume } from "@solana/spl-token";

import { Compliance } from "./compliance";
import type {
  CreateOptions,
  LoadOptions,
  MintOptions,
  BurnOptions,
  FreezeOptions,
  ThawOptions,
  SetAuthorityOptions,
  SupplyInfo,
  BalanceInfo,
  TokenStatus,
  AuditLogEntry,
  TransferHookConfig,
  Presets,
} from "./types";

const ASSUMED_FINAL_MINT_SIZE = 4096;

const AUTHORITY_TYPE_MAP: Record<string, AuthorityType> = {
  mint: AuthorityType.MintTokens,
  freeze: AuthorityType.FreezeAccount,
  metadata: AuthorityType.MetadataPointer,
  "metadata-pointer": AuthorityType.MetadataPointer,
  pause: AuthorityType.PausableConfig,
  "permanent-delegate": AuthorityType.PermanentDelegate,
  "transfer-fee-config": AuthorityType.TransferFeeConfig,
  "close-mint": AuthorityType.CloseMint,
  "interest-rate": AuthorityType.InterestRate,
};

function toPublicKey(input: Keypair | PublicKey): PublicKey {
  return "publicKey" in input ? input.publicKey : input;
}

/**
 * Main entry point for the Solana Stablecoin Standard SDK.
 *
 * Use the static factories to get an instance:
 * - `SolanaStablecoin.create()` -- deploy a new stablecoin mint.
 * - `SolanaStablecoin.load()` -- connect to an existing mint.
 *
 * Then call instance methods for all token operations.
 */
export class SolanaStablecoin {
  /** Connection to the Solana cluster. */
  readonly connection: Connection;
  /** On-chain mint address. */
  readonly mint: PublicKey;
  /** Token program (TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID). */
  readonly tokenProgramId: PublicKey;
  /**
   * Compliance operations (blacklist). Only available when a transfer-hook
   * program ID is configured (SSS-2).
   */
  readonly compliance: Compliance | null;

  private constructor(
    connection: Connection,
    mint: PublicKey,
    tokenProgramId: PublicKey,
    hookProgramId: PublicKey | null,
  ) {
    this.connection = connection;
    this.mint = mint;
    this.tokenProgramId = tokenProgramId;
    this.compliance = hookProgramId
      ? new Compliance(connection, mint, hookProgramId)
      : null;
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  /**
   * Deploy a new stablecoin mint on-chain and return a configured instance.
   *
   * @example
   * ```ts
   * const stable = await SolanaStablecoin.create(connection, {
   *   preset: Presets.SSS_1,
   *   name: "My Dollar",
   *   symbol: "MUSD",
   *   decimals: 6,
   *   authority: adminKeypair,
   * });
   * ```
   */
  static async create(connection: Connection, opts: CreateOptions): Promise<SolanaStablecoin> {
    const decimals = opts.decimals ?? 6;
    const name = opts.name;
    const symbol = opts.symbol;
    const uri = opts.uri ?? "";
    const payer = opts.authority;
    const mintAuthorityPk = payer.publicKey;
    const freezeAuthorityPk = opts.freezeAuthority
      ? toPublicKey(opts.freezeAuthority)
      : payer.publicKey;
    const metadataAuthorityPk = opts.metadataAuthority
      ? toPublicKey(opts.metadataAuthority)
      : payer.publicKey;

    const preset = opts.preset;
    const ext = opts.extensions ?? {};
    const metadataEnabled = ext.metadata !== false; // default true
    const transferHookCfg = resolveTransferHook(ext.transferHook, preset);
    const transferHookEnabled = transferHookCfg !== null;

    if (preset === ("sss-2" as Presets) && !transferHookEnabled) {
      throw new Error(
        "SSS-2 requires a transfer hook. Provide extensions.transferHook with a programId.",
      );
    }

    const useExtensions = metadataEnabled || transferHookEnabled;
    const tokenProgramId = useExtensions ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    let mintPk: PublicKey;

    if (useExtensions) {
      const mintKeypair = Keypair.generate();
      mintPk = mintKeypair.publicKey;

      const extensionTypes: ExtensionType[] = [];
      if (metadataEnabled) extensionTypes.push(ExtensionType.MetadataPointer);
      if (transferHookEnabled) extensionTypes.push(ExtensionType.TransferHook);

      const mintSpace = getMintLen(extensionTypes);
      const lamports = await connection.getMinimumBalanceForRentExemption(ASSUMED_FINAL_MINT_SIZE);

      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mintPk,
          space: mintSpace,
          lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      );

      if (metadataEnabled) {
        tx.add(
          createInitializeMetadataPointerInstruction(
            mintPk,
            metadataAuthorityPk,
            mintPk,
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      }

      if (transferHookEnabled) {
        const hookAuthority = transferHookCfg.admin
          ? transferHookCfg.admin.publicKey
          : payer.publicKey;
        tx.add(
          createInitializeTransferHookInstruction(
            mintPk,
            hookAuthority,
            transferHookCfg.programId,
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      }

      tx.add(
        createInitializeMint2Instruction(
          mintPk,
          decimals,
          mintAuthorityPk,
          freezeAuthorityPk,
          TOKEN_2022_PROGRAM_ID,
        ),
      );

      await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair], {
        commitment: "confirmed",
      });

      if (metadataEnabled) {
        await tokenMetadataInitialize(
          connection,
          payer,
          mintPk,
          metadataAuthorityPk,
          payer,
          name,
          symbol,
          uri,
          [],
          { commitment: "confirmed" },
          TOKEN_2022_PROGRAM_ID,
        );
      }

      if (transferHookEnabled) {
        const hookAdmin = transferHookCfg.admin ?? payer;
        const compliance = new Compliance(connection, mintPk, transferHookCfg.programId);
        await compliance.initializeHook(hookAdmin);
      }
    } else {
      mintPk = await createMint(
        connection,
        payer,
        mintAuthorityPk,
        freezeAuthorityPk,
        decimals,
        undefined,
        undefined,
        tokenProgramId,
      );
    }

    const hookProgramId = transferHookEnabled ? transferHookCfg.programId : null;
    return new SolanaStablecoin(connection, mintPk, tokenProgramId, hookProgramId);
  }

  /**
   * Connect to an existing on-chain mint.
   *
   * @example
   * ```ts
   * const stable = SolanaStablecoin.load(connection, {
   *   mint: new PublicKey("7NDka..."),
   *   transferHookProgramId: new PublicKey("84rPj..."), // optional, for blacklist
   * });
   * ```
   */
  static load(connection: Connection, opts: LoadOptions): SolanaStablecoin {
    const tokenProgramId = opts.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;
    return new SolanaStablecoin(
      connection,
      opts.mint,
      tokenProgramId,
      opts.transferHookProgramId ?? null,
    );
  }

  // ---------------------------------------------------------------------------
  // Token operations
  // ---------------------------------------------------------------------------

  /**
   * Mint tokens to a recipient. Creates the ATA if it doesn't exist.
   * @returns Transaction signature.
   */
  async mintTokens(opts: MintOptions): Promise<string> {
    const destAta = await createAssociatedTokenAccountIdempotent(
      this.connection,
      opts.minter,
      this.mint,
      opts.recipient,
      { commitment: "confirmed" },
      this.tokenProgramId,
    );

    return mintTo(
      this.connection,
      opts.minter,
      this.mint,
      destAta,
      opts.minter,
      opts.amount,
      [],
      { commitment: "confirmed" },
      this.tokenProgramId,
    );
  }

  /**
   * Burn tokens. Burns from the owner's ATA unless `tokenAccount` is specified.
   * @returns Transaction signature.
   */
  async burn(opts: BurnOptions): Promise<string> {
    const sourceAta = opts.tokenAccount ?? getAssociatedTokenAddressSync(
      this.mint,
      opts.owner.publicKey,
      false,
      this.tokenProgramId,
    );

    return burn(
      this.connection,
      opts.owner,
      sourceAta,
      this.mint,
      opts.owner,
      opts.amount,
      [],
      { commitment: "confirmed" },
      this.tokenProgramId,
    );
  }

  /**
   * Freeze a token account.
   * @returns Transaction signature.
   */
  async freeze(opts: FreezeOptions): Promise<string> {
    return freezeAccount(
      this.connection,
      opts.freezeAuthority,
      opts.tokenAccount,
      this.mint,
      opts.freezeAuthority,
      [],
      { commitment: "confirmed" },
      this.tokenProgramId,
    );
  }

  /**
   * Thaw a frozen token account.
   * @returns Transaction signature.
   */
  async thaw(opts: ThawOptions): Promise<string> {
    return thawAccount(
      this.connection,
      opts.freezeAuthority,
      opts.tokenAccount,
      this.mint,
      opts.freezeAuthority,
      [],
      { commitment: "confirmed" },
      this.tokenProgramId,
    );
  }

  /**
   * Pause the mint (Token-2022 Pausable extension).
   * @returns Transaction signature.
   */
  async pause(authority: Keypair): Promise<string> {
    return pause(
      this.connection,
      authority,
      this.mint,
      authority,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );
  }

  /**
   * Unpause the mint (Token-2022 Pausable extension).
   * @returns Transaction signature.
   */
  async unpause(authority: Keypair): Promise<string> {
    return resume(
      this.connection,
      authority,
      this.mint,
      authority,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );
  }

  /**
   * Change an on-chain authority (mint, freeze, metadata, pause, etc.).
   * @returns Transaction signature.
   */
  async setAuthority(opts: SetAuthorityOptions): Promise<string> {
    const authorityType = AUTHORITY_TYPE_MAP[opts.type];
    if (authorityType === undefined) {
      throw new Error(
        `Unknown authority type "${opts.type}". Valid types: ${Object.keys(AUTHORITY_TYPE_MAP).join(", ")}`,
      );
    }

    const tx = new Transaction().add(
      createSetAuthorityInstruction(
        this.mint,
        opts.currentAuthority.publicKey,
        authorityType,
        opts.newAuthority,
        [],
        this.tokenProgramId,
      ),
    );

    return sendAndConfirmTransaction(
      this.connection,
      tx,
      [opts.currentAuthority],
      { commitment: "confirmed" },
    );
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /** Fetch total supply. */
  async getSupply(): Promise<SupplyInfo> {
    const mintInfo = await getMint(this.connection, this.mint, undefined, this.tokenProgramId);
    const dec = mintInfo.decimals;
    return {
      raw: mintInfo.supply,
      uiAmount: Number(mintInfo.supply) / Math.pow(10, dec),
      decimals: dec,
    };
  }

  /** Fetch balance of a wallet for this mint. */
  async getBalance(wallet: PublicKey): Promise<BalanceInfo> {
    const ata = getAssociatedTokenAddressSync(this.mint, wallet, false, this.tokenProgramId);
    try {
      const account = await getAccount(this.connection, ata, undefined, this.tokenProgramId);
      const dec = (await getMint(this.connection, this.mint, undefined, this.tokenProgramId)).decimals;
      return {
        raw: account.amount,
        uiAmount: Number(account.amount) / Math.pow(10, dec),
        ata,
        exists: true,
      };
    } catch {
      return { raw: 0n, uiAmount: 0, ata, exists: false };
    }
  }

  /** Fetch on-chain mint status (supply, authorities). */
  async getStatus(): Promise<TokenStatus> {
    const mintInfo = await getMint(this.connection, this.mint, undefined, this.tokenProgramId);
    const dec = mintInfo.decimals;
    return {
      mint: this.mint,
      supply: {
        raw: mintInfo.supply,
        uiAmount: Number(mintInfo.supply) / Math.pow(10, dec),
        decimals: dec,
      },
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
    };
  }

  /**
   * Fetch recent transaction signatures involving this mint.
   * @param limit Number of signatures to fetch (default 20, max 1000).
   */
  async getAuditLog(limit = 20): Promise<AuditLogEntry[]> {
    const capped = Math.max(1, Math.min(1000, limit));
    const signatures = await this.connection.getSignaturesForAddress(this.mint, { limit: capped });

    return signatures.map((sig) => ({
      signature: sig.signature,
      slot: sig.slot,
      err: sig.err,
      blockTime:
        sig.blockTime !== null && sig.blockTime !== undefined
          ? new Date(sig.blockTime * 1000)
          : null,
    }));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveTransferHook(
  input: boolean | TransferHookConfig | undefined,
  preset: Presets | undefined,
): TransferHookConfig | null {
  if (input === false || input === undefined) {
    return null;
  }
  if (input === true) {
    throw new Error(
      "extensions.transferHook = true requires a TransferHookConfig object with a programId.",
    );
  }
  return input;
}
