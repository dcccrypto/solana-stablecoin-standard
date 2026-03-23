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
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferHookInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializePausableConfigInstruction,
  createInitializeDefaultAccountStateInstruction,
  createSetAuthorityInstruction,
  createMintToInstruction,
  createBurnInstruction,
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  tokenMetadataInitialize,
  createMint,
  mintTo,
  burn,
  freezeAccount,
  thawAccount,
  AuthorityType,
  AccountState,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import { pause, resume } from "@solana/spl-token";

import { Compliance } from "./compliance";
import { SssCoreClient } from "./core";
import type {
  CreateOptions,
  LoadOptions,
  MintOptions,
  BurnOptions,
  TransferOptions,
  SeizeOptions,
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
 * Format a bigint token amount as a human-readable decimal string.
 * Safe for amounts > 2^53 (unlike Number conversion).
 */
function formatUiAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const str = raw.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals);
  const fracPart = str.slice(str.length - decimals);
  return `${intPart}.${fracPart}`;
}

/**
 * Main entry point for the Solana Stablecoin Standard SDK.
 *
 * Use the static factories to get an instance:
 * - `SolanaStablecoin.create()` — deploy a new stablecoin mint.
 * - `SolanaStablecoin.load()` — connect to an existing mint.
 *
 * Then call instance methods for all token operations, or use
 * the `build*` variants to get unsigned transactions for wallet adapters.
 */
export class SolanaStablecoin {
  readonly connection: Connection;
  readonly mint: PublicKey;
  readonly tokenProgramId: PublicKey;
  readonly compliance: Compliance | null;
  /**
   * SSS-Core program client. Available when `ssCoreProgramId` is provided
   * on load, or after `create()` with sss-core integration.
   * Provides RBAC-gated operations (mint, burn, freeze, seize, pause, roles).
   */
  readonly core: SssCoreClient | null;

  private _decimals: number | null = null;
  private _cachedStatus: TokenStatus | null = null;

  protected constructor(
    connection: Connection,
    mint: PublicKey,
    tokenProgramId: PublicKey,
    hookProgramId: PublicKey | null,
    ssCoreProgramId: PublicKey | null = null,
  ) {
    this.connection = connection;
    this.mint = mint;
    this.tokenProgramId = tokenProgramId;
    this.compliance = hookProgramId
      ? new Compliance(connection, mint, hookProgramId)
      : null;
    this.core = ssCoreProgramId
      ? new SssCoreClient(connection, mint, ssCoreProgramId, tokenProgramId)
      : null;
  }

  // ─── Static factories ──────────────────────────────────────────────────────

  static async create(
    connection: Connection,
    opts: CreateOptions,
  ): Promise<SolanaStablecoin> {
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
    const metadataEnabled = ext.metadata !== false;
    const pausableEnabled = ext.pausable === true;
    const permanentDelegateEnabled = ext.permanentDelegate === true;
    const defaultFrozen = ext.defaultAccountStateFrozen === true;
    const transferHookCfg = resolveTransferHook(ext.transferHook, preset);
    const transferHookEnabled = transferHookCfg !== null;

    if (preset === ("sss-2" as Presets) && !transferHookEnabled) {
      throw new Error(
        "SSS-2 requires a transfer hook. Provide extensions.transferHook with a programId.",
      );
    }

    const useExtensions =
      metadataEnabled || transferHookEnabled || pausableEnabled || permanentDelegateEnabled || defaultFrozen;
    const tokenProgramId = useExtensions
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    let mintPk: PublicKey;

    if (useExtensions) {
      const mintKeypair = Keypair.generate();
      mintPk = mintKeypair.publicKey;

      const extensionTypes: ExtensionType[] = [];
      if (metadataEnabled) extensionTypes.push(ExtensionType.MetadataPointer);
      if (transferHookEnabled) extensionTypes.push(ExtensionType.TransferHook);
      if (pausableEnabled) extensionTypes.push(ExtensionType.PausableConfig);
      if (permanentDelegateEnabled) extensionTypes.push(ExtensionType.PermanentDelegate);
      if (defaultFrozen) extensionTypes.push(ExtensionType.DefaultAccountState);

      const mintSpace = getMintLen(extensionTypes);
      // tokenMetadataInitialize reallocs the account to store name/symbol/uri,
      // so we need lamports for the post-realloc size, not just the extensions.
      const rentSize = metadataEnabled ? Math.max(mintSpace, 4096) : mintSpace;
      const lamports = await connection.getMinimumBalanceForRentExemption(rentSize);

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

      if (permanentDelegateEnabled) {
        tx.add(
          createInitializePermanentDelegateInstruction(
            mintPk,
            payer.publicKey,
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      }

      if (pausableEnabled) {
        tx.add(
          createInitializePausableConfigInstruction(
            mintPk,
            payer.publicKey,
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      }

      if (defaultFrozen) {
        tx.add(
          createInitializeDefaultAccountStateInstruction(
            mintPk,
            AccountState.Frozen,
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
        const compliance = new Compliance(
          connection,
          mintPk,
          transferHookCfg.programId,
        );
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

    const hookProgramId = transferHookEnabled
      ? transferHookCfg.programId
      : null;

    const ssCoreProgramId = opts.ssCoreProgramId ?? null;

    if (ssCoreProgramId) {
      const coreClient = new SssCoreClient(
        connection,
        mintPk,
        ssCoreProgramId,
        tokenProgramId,
      );
      const presetNum = preset === ("sss-2" as Presets) ? 2 : 1;
      const complianceEnabled = preset === ("sss-2" as Presets);
      await coreClient.initialize(
        payer,
        presetNum,
        opts.supplyCap ?? null,
        complianceEnabled,
        hookProgramId ?? null,
      );
    }

    return new SolanaStablecoin(connection, mintPk, tokenProgramId, hookProgramId, ssCoreProgramId);
  }

  static load(connection: Connection, opts: LoadOptions): SolanaStablecoin {
    const tokenProgramId = opts.tokenProgramId ?? TOKEN_2022_PROGRAM_ID;
    return new SolanaStablecoin(
      connection,
      opts.mint,
      tokenProgramId,
      opts.transferHookProgramId ?? null,
      opts.ssCoreProgramId ?? null,
    );
  }

  // ─── State caching (vault standard pattern) ───────────────────────────────

  /**
   * Refresh cached state from the chain (mint info + sss-core config if available).
   */
  async refresh(): Promise<void> {
    const mintInfo = await getMint(
      this.connection,
      this.mint,
      undefined,
      this.tokenProgramId,
    );
    const dec = mintInfo.decimals;
    this._decimals = dec;
    this._cachedStatus = {
      mint: this.mint,
      supply: {
        raw: mintInfo.supply,
        uiAmount: Number(mintInfo.supply) / Math.pow(10, dec),
        uiAmountString: formatUiAmount(mintInfo.supply, dec),
        decimals: dec,
      },
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
    };

    if (this.core) {
      await this.core.refresh();
    }
  }

  /**
   * Return last cached state (call `refresh()` first, or methods that auto-refresh).
   */
  getState(): TokenStatus | null {
    return this._cachedStatus;
  }

  // ─── Token operations ──────────────────────────────────────────────────────

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

  async burn(opts: BurnOptions): Promise<string> {
    const sourceAta =
      opts.tokenAccount ??
      getAssociatedTokenAddressSync(
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
   * Transfer tokens with hook support (SSS-2). Automatically resolves
   * extra accounts required by the transfer hook.
   */
  async transfer(opts: TransferOptions): Promise<string> {
    const sourceAta =
      opts.sourceTokenAccount ??
      getAssociatedTokenAddressSync(
        this.mint,
        opts.owner.publicKey,
        false,
        this.tokenProgramId,
      );

    const destAta =
      opts.destinationTokenAccount ??
      getAssociatedTokenAddressSync(
        this.mint,
        opts.destination,
        false,
        this.tokenProgramId,
      );

    const tx = new Transaction();

    const destInfo = await this.connection.getAccountInfo(destAta);
    if (!destInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          opts.owner.publicKey,
          destAta,
          opts.destination,
          this.mint,
          this.tokenProgramId,
        ),
      );
    }

    const transferIx =
      await createTransferCheckedWithTransferHookInstruction(
        this.connection,
        sourceAta,
        this.mint,
        destAta,
        opts.owner.publicKey,
        opts.amount,
        opts.decimals,
        [],
        "confirmed",
        this.tokenProgramId,
      );
    tx.add(transferIx);

    return sendAndConfirmTransaction(this.connection, tx, [opts.owner], {
      commitment: "confirmed",
    });
  }

  /**
   * Build an unsigned transfer transaction (for wallet adapter / Phantom).
   * Caller signs and sends.
   */
  async buildTransferTransaction(
    owner: PublicKey,
    destination: PublicKey,
    amount: bigint,
    decimals: number,
  ): Promise<Transaction> {
    const sourceAta = getAssociatedTokenAddressSync(
      this.mint,
      owner,
      false,
      this.tokenProgramId,
    );
    const destAta = getAssociatedTokenAddressSync(
      this.mint,
      destination,
      false,
      this.tokenProgramId,
    );

    const tx = new Transaction();

    const destInfo = await this.connection.getAccountInfo(destAta);
    if (!destInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          destAta,
          destination,
          this.mint,
          this.tokenProgramId,
        ),
      );
    }

    const transferIx =
      await createTransferCheckedWithTransferHookInstruction(
        this.connection,
        sourceAta,
        this.mint,
        destAta,
        owner,
        amount,
        decimals,
        [],
        "confirmed",
        this.tokenProgramId,
      );
    tx.add(transferIx);

    return tx;
  }

  /**
   * Build an unsigned mint transaction (for wallet adapter / Phantom).
   */
  async buildMintTransaction(
    payer: PublicKey,
    recipient: PublicKey,
    amount: bigint,
  ): Promise<Transaction> {
    const ata = getAssociatedTokenAddressSync(
      this.mint,
      recipient,
      false,
      this.tokenProgramId,
    );
    const tx = new Transaction();
    const ataInfo = await this.connection.getAccountInfo(ata);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer,
          ata,
          recipient,
          this.mint,
          this.tokenProgramId,
        ),
      );
    }
    tx.add(createMintToInstruction(this.mint, ata, payer, amount, [], this.tokenProgramId));
    return tx;
  }

  /**
   * Build an unsigned burn transaction (for wallet adapter / Phantom).
   */
  buildBurnTransaction(
    owner: PublicKey,
    amount: bigint,
    tokenAccount?: PublicKey,
  ): Transaction {
    const ata =
      tokenAccount ??
      getAssociatedTokenAddressSync(this.mint, owner, false, this.tokenProgramId);
    return new Transaction().add(
      createBurnInstruction(ata, this.mint, owner, amount, [], this.tokenProgramId),
    );
  }

  /**
   * Build an unsigned freeze transaction (for wallet adapter).
   */
  buildFreezeTransaction(
    tokenAccount: PublicKey,
    freezeAuthority: PublicKey,
  ): Transaction {
    return new Transaction().add(
      createFreezeAccountInstruction(
        tokenAccount,
        this.mint,
        freezeAuthority,
        [],
        this.tokenProgramId,
      ),
    );
  }

  /**
   * Build an unsigned thaw transaction (for wallet adapter).
   */
  buildThawTransaction(
    tokenAccount: PublicKey,
    freezeAuthority: PublicKey,
  ): Transaction {
    return new Transaction().add(
      createThawAccountInstruction(
        tokenAccount,
        this.mint,
        freezeAuthority,
        [],
        this.tokenProgramId,
      ),
    );
  }

  /**
   * Build an unsigned seize transaction (for wallet adapter).
   * The caller must sign with the permanent delegate / freeze authority.
   */
  async buildSeizeTransaction(
    authority: PublicKey,
    targetTokenAccount: PublicKey,
    treasury: PublicKey,
    amount: bigint,
  ): Promise<Transaction> {
    const treasuryAta = getAssociatedTokenAddressSync(
      this.mint,
      treasury,
      false,
      this.tokenProgramId,
    );

    const tx = new Transaction();
    const treasuryInfo = await this.connection.getAccountInfo(treasuryAta);
    if (!treasuryInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          authority,
          treasuryAta,
          treasury,
          this.mint,
          this.tokenProgramId,
        ),
      );
    }
    tx.add(createThawAccountInstruction(targetTokenAccount, this.mint, authority, [], this.tokenProgramId));
    tx.add(createBurnInstruction(targetTokenAccount, this.mint, authority, amount, [], this.tokenProgramId));
    tx.add(createMintToInstruction(this.mint, treasuryAta, authority, amount, [], this.tokenProgramId));
    tx.add(createFreezeAccountInstruction(targetTokenAccount, this.mint, authority, [], this.tokenProgramId));
    return tx;
  }

  /**
   * Build an unsigned set-authority transaction (for wallet adapter).
   */
  buildSetAuthorityTransaction(
    currentAuthority: PublicKey,
    type: string,
    newAuthority: PublicKey | null,
  ): Transaction {
    const authorityType = AUTHORITY_TYPE_MAP[type];
    if (authorityType === undefined) {
      throw new Error(
        `Unknown authority type "${type}". Valid types: ${Object.keys(AUTHORITY_TYPE_MAP).join(", ")}`,
      );
    }
    return new Transaction().add(
      createSetAuthorityInstruction(
        this.mint,
        currentAuthority,
        authorityType,
        newAuthority,
        [],
        this.tokenProgramId,
      ),
    );
  }

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
   * Seize tokens from a frozen account using the burn+mint pattern.
   * Requires the authority to be the permanent delegate and freeze authority.
   * Flow: thaw → burn (via permanent delegate) → mint to treasury → re-freeze.
   */
  async seize(opts: SeizeOptions): Promise<string> {
    const dec = await this.getDecimals();

    const treasuryAta = getAssociatedTokenAddressSync(
      this.mint,
      opts.treasury,
      false,
      this.tokenProgramId,
    );

    const tx = new Transaction();

    // Create treasury ATA if needed
    const treasuryInfo = await this.connection.getAccountInfo(treasuryAta);
    if (!treasuryInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          opts.authority.publicKey,
          treasuryAta,
          opts.treasury,
          this.mint,
          this.tokenProgramId,
        ),
      );
    }

    // 1. Thaw the frozen account
    tx.add(
      createThawAccountInstruction(
        opts.targetTokenAccount,
        this.mint,
        opts.authority.publicKey,
        [],
        this.tokenProgramId,
      ),
    );

    // 2. Burn from target (permanent delegate can burn from any account)
    tx.add(
      createBurnInstruction(
        opts.targetTokenAccount,
        this.mint,
        opts.authority.publicKey,
        opts.amount,
        [],
        this.tokenProgramId,
      ),
    );

    // 3. Mint to treasury
    tx.add(
      createMintToInstruction(
        this.mint,
        treasuryAta,
        opts.authority.publicKey,
        opts.amount,
        [],
        this.tokenProgramId,
      ),
    );

    // 4. Re-freeze the target account
    tx.add(
      createFreezeAccountInstruction(
        opts.targetTokenAccount,
        this.mint,
        opts.authority.publicKey,
        [],
        this.tokenProgramId,
      ),
    );

    return sendAndConfirmTransaction(this.connection, tx, [opts.authority], {
      commitment: "confirmed",
    });
  }

  // ─── Batch operations ─────────────────────────────────────────────────────

  async batchMint(
    minter: Keypair,
    recipients: { recipient: PublicKey; amount: bigint }[],
  ): Promise<string> {
    const tx = new Transaction();
    for (const { recipient, amount } of recipients) {
      const ata = await createAssociatedTokenAccountIdempotent(
        this.connection,
        minter,
        this.mint,
        recipient,
        { commitment: "confirmed" },
        this.tokenProgramId,
      );
      tx.add(
        createMintToInstruction(
          this.mint,
          ata,
          minter.publicKey,
          amount,
          [],
          this.tokenProgramId,
        ),
      );
    }
    return sendAndConfirmTransaction(this.connection, tx, [minter], {
      commitment: "confirmed",
    });
  }

  batchFreeze(
    authority: PublicKey,
    tokenAccounts: PublicKey[],
  ): Transaction {
    const tx = new Transaction();
    for (const ta of tokenAccounts) {
      tx.add(
        createFreezeAccountInstruction(
          ta,
          this.mint,
          authority,
          [],
          this.tokenProgramId,
        ),
      );
    }
    return tx;
  }

  batchThaw(
    authority: PublicKey,
    tokenAccounts: PublicKey[],
  ): Transaction {
    const tx = new Transaction();
    for (const ta of tokenAccounts) {
      tx.add(
        createThawAccountInstruction(
          ta,
          this.mint,
          authority,
          [],
          this.tokenProgramId,
        ),
      );
    }
    return tx;
  }

  async pause(authority: Keypair): Promise<string> {
    return pause(
      this.connection,
      authority,
      this.mint,
      authority,
      [],
      { commitment: "confirmed" },
      this.tokenProgramId,
    );
  }

  async unpause(authority: Keypair): Promise<string> {
    return resume(
      this.connection,
      authority,
      this.mint,
      authority,
      [],
      { commitment: "confirmed" },
      this.tokenProgramId,
    );
  }

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

  // ─── Read operations ───────────────────────────────────────────────────────

  async getDecimals(): Promise<number> {
    if (this._decimals !== null) return this._decimals;
    const mintInfo = await getMint(
      this.connection,
      this.mint,
      undefined,
      this.tokenProgramId,
    );
    this._decimals = mintInfo.decimals;
    return mintInfo.decimals;
  }

  async getSupply(): Promise<SupplyInfo> {
    const mintInfo = await getMint(
      this.connection,
      this.mint,
      undefined,
      this.tokenProgramId,
    );
    const dec = mintInfo.decimals;
    return {
      raw: mintInfo.supply,
      uiAmount: Number(mintInfo.supply) / Math.pow(10, dec),
      uiAmountString: formatUiAmount(mintInfo.supply, dec),
      decimals: dec,
    };
  }

  async getBalance(wallet: PublicKey): Promise<BalanceInfo> {
    const ata = getAssociatedTokenAddressSync(
      this.mint,
      wallet,
      false,
      this.tokenProgramId,
    );
    try {
      const account = await getAccount(
        this.connection,
        ata,
        undefined,
        this.tokenProgramId,
      );
      const dec = await this.getDecimals();
      return {
        raw: account.amount,
        uiAmount: Number(account.amount) / Math.pow(10, dec),
        uiAmountString: formatUiAmount(account.amount, dec),
        ata,
        exists: true,
      };
    } catch (e: unknown) {
      if (
        e instanceof TokenAccountNotFoundError ||
        e instanceof TokenInvalidAccountOwnerError
      ) {
        return {
          raw: 0n,
          uiAmount: 0,
          uiAmountString: "0",
          ata,
          exists: false,
        };
      }
      throw e;
    }
  }

  async getStatus(): Promise<TokenStatus> {
    const mintInfo = await getMint(
      this.connection,
      this.mint,
      undefined,
      this.tokenProgramId,
    );
    const dec = mintInfo.decimals;
    return {
      mint: this.mint,
      supply: {
        raw: mintInfo.supply,
        uiAmount: Number(mintInfo.supply) / Math.pow(10, dec),
        uiAmountString: formatUiAmount(mintInfo.supply, dec),
        decimals: dec,
      },
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
    };
  }

  async getAuditLog(limit = 20): Promise<AuditLogEntry[]> {
    const capped = Math.max(1, Math.min(1000, limit));
    const signatures = await this.connection.getSignaturesForAddress(
      this.mint,
      { limit: capped },
    );

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

// ─── Internal helpers ────────────────────────────────────────────────────────

function resolveTransferHook(
  input: boolean | TransferHookConfig | undefined,
  _preset: Presets | undefined,
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
