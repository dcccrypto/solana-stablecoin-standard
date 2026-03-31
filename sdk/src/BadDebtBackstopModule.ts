import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum backstop draw as a percentage of net supply, in basis points.
 * Matches `max_backstop_bps` upper bound enforced on-chain.
 */
export const MAX_BACKSTOP_BPS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for {@link BadDebtBackstopModule.setBackstopParams}.
 */
export interface SetBackstopParamsArgs {
  /** The SSS-3 stablecoin mint (preset 3 only). */
  mint: PublicKey;
  /**
   * Insurance fund token account pubkey.
   * Pass `PublicKey.default()` to disable the backstop.
   */
  insuranceFundPubkey: PublicKey;
  /**
   * Maximum backstop draw in basis points of net supply (0 = unlimited).
   * E.g. 500 = draw at most 5% of net supply.  Must be ≤ 10_000.
   */
  maxBackstopBps: number;
}

/**
 * Parameters for {@link BadDebtBackstopModule.triggerBackstop}.
 */
export interface TriggerBackstopArgs {
  /** The SSS-3 stablecoin mint (preset 3 only). */
  mint: PublicKey;
  /**
   * The CDP owner whose position generated the bad debt.
   * Used to derive the CdpPosition and CollateralVault PDAs on-chain.
   */
  cdpOwner: PublicKey;
  /**
   * Oracle price feed account — Pyth, Switchboard, or custom feed registered
   * in StablecoinConfig.  The on-chain handler validates this against config.
   */
  oraclePriceFeed: PublicKey;
  /** Insurance fund token account (source of backstop collateral). */
  insuranceFund: PublicKey;
  /** Reserve vault token account (destination for backstop collateral). */
  reserveVault: PublicKey;
  /** The collateral token mint (e.g. USDC). */
  collateralMint: PublicKey;
  /** Insurance fund authority — signs to allow SPL token transfer. */
  insuranceFundAuthority: PublicKey;
  /** Token program for the collateral (usually TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID). */
  collateralTokenProgram: PublicKey;
}

/**
 * Backstop configuration read from `StablecoinConfig`.
 */
export interface BackstopConfig {
  /** Insurance fund vault pubkey; PublicKey.default() when disabled. */
  insuranceFundPubkey: PublicKey;
  /**
   * Maximum draw in bps of net supply.
   * 0 = unlimited.
   */
  maxBackstopBps: number;
  /** True when a valid insurance fund is configured. */
  enabled: boolean;
}

/**
 * Parameters for {@link BadDebtBackstopModule.contributeToBackstop}.
 */
export interface ContributeToBackstopArgs {
  /** Insurance fund token account (destination — the configured backstop vault). */
  insuranceFund: PublicKey;
  /** Contributor's source token account. */
  sourceTokenAccount: PublicKey;
  /** Contributor's wallet/signer public key. */
  contributor: PublicKey;
  /** The collateral token mint. */
  collateralMint: PublicKey;
  /** Number of decimal places for the collateral mint. */
  collateralDecimals: number;
  /** Amount to deposit (in native token units). */
  amount: bigint;
  /** Token program to use (defaults to TOKEN_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Parameters for {@link BadDebtBackstopModule.withdrawFromBackstop}.
 */
export interface WithdrawFromBackstopArgs {
  /** Insurance fund token account (source). */
  insuranceFund: PublicKey;
  /** Insurance fund authority signer. */
  insuranceFundAuthority: PublicKey;
  /** Destination token account (receives withdrawn tokens). */
  destinationTokenAccount: PublicKey;
  /** The collateral token mint. */
  collateralMint: PublicKey;
  /** Number of decimal places for the collateral mint. */
  collateralDecimals: number;
  /** Amount to withdraw (in native token units). */
  amount: bigint;
  /** Token program to use (defaults to TOKEN_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Parameters for {@link BadDebtBackstopModule.triggerBadDebtSocialization}.
 * Alias for {@link TriggerBackstopArgs} — maps to the on-chain `trigger_backstop` instruction.
 */
export type TriggerBadDebtSocializationArgs = TriggerBackstopArgs;

/**
 * Backstop fund state — combines on-chain config with live insurance fund balance.
 */
export interface BackstopFundState {
  /** Insurance fund vault pubkey (PublicKey.default() when disabled). */
  insuranceFundPubkey: PublicKey;
  /** Maximum backstop draw in bps of net supply (0 = unlimited). */
  maxBackstopBps: number;
  /** Whether the backstop is configured and enabled. */
  enabled: boolean;
  /** Current token balance in the insurance fund vault (native units). */
  fundBalance: bigint;
  /** Token mint held by the insurance fund. */
  fundMint: PublicKey;
}

// ─── Anchor discriminators (SHA-256("global:<ix>")[0..8]) ────────────────────
// Pre-computed to avoid a full IDL dependency at runtime.

// SHA-256("global:set_backstop_params")[0..8]
const DISCRIMINATOR_SET_BACKSTOP_PARAMS = Buffer.from([
  0x74, 0x56, 0xc6, 0x29, 0x15, 0xa3, 0x1d, 0xdd,
]);

// SHA-256("global:trigger_backstop")[0..8]
const DISCRIMINATOR_TRIGGER_BACKSTOP = Buffer.from([
  0x25, 0x3e, 0xea, 0xdf, 0x50, 0x96, 0xd9, 0xe4,
]);

// ─── BadDebtBackstopModule ────────────────────────────────────────────────────

/**
 * BadDebtBackstopModule — SDK client for SSS-097 bad-debt backstop instructions.
 *
 * Wraps:
 * - `set_backstop_params` — authority-only; configure the insurance fund vault
 *   and max backstop draw cap on the `StablecoinConfig` (preset 3 only).
 * - `trigger_backstop` — CPI-only (must be signed by config PDA); draws up to
 *   `max_backstop_bps` of net supply from the insurance fund into the reserve
 *   vault to cover a post-liquidation collateral shortfall.
 *
 * Preset restriction: both instructions require `config.preset == 3`.
 *
 * @example
 * ```ts
 * import { BadDebtBackstopModule } from '@sss/sdk';
 * import { PublicKey } from '@solana/web3.js';
 * import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
 *
 * const backstop = new BadDebtBackstopModule(provider, programId);
 *
 * // Authority: configure insurance fund (500 bps = 5% max draw)
 * await backstop.setBackstopParams({
 *   mint,
 *   insuranceFundPubkey: insuranceFundTokenAccount,
 *   maxBackstopBps: 500,
 * });
 *
 * // Read current config
 * const config = await backstop.fetchBackstopConfig(mint);
 * console.log(config.enabled, config.maxBackstopBps); // true, 500
 *
 * // Off-chain: estimate max draw
 * const maxDraw = backstop.computeMaxDraw({ netSupply: 1_000_000n, maxBackstopBps: 500, shortfall: 40_000n });
 * console.log(maxDraw); // 50_000n (capped by shortfall: 40_000n)
 * ```
 */
export class BadDebtBackstopModule {
  constructor(
    private readonly provider: AnchorProvider,
    private readonly programId: PublicKey,
  ) {}

  // ─── PDA helpers ──────────────────────────────────────────────────────────

  /**
   * Derives the `StablecoinConfig` PDA for a given mint.
   */
  configPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('stablecoin-config'), mint.toBuffer()],
      this.programId,
    );
  }

  // ─── Write instructions ───────────────────────────────────────────────────

  /**
   * Configure the insurance fund vault and max backstop draw cap.
   *
   * Only the stablecoin `authority` may call this (preset 3 only).
   * Pass `PublicKey.default()` for `insuranceFundPubkey` to disable the backstop.
   *
   * @param args.mint                 - The SSS-3 stablecoin mint.
   * @param args.insuranceFundPubkey  - Insurance fund token account (or default to disable).
   * @param args.maxBackstopBps       - Max draw in bps of net supply (0–10_000). 0 = unlimited.
   * @returns Transaction signature.
   * @throws When `maxBackstopBps` > {@link MAX_BACKSTOP_BPS}.
   */
  async setBackstopParams(args: SetBackstopParamsArgs): Promise<TransactionSignature> {
    const { mint, insuranceFundPubkey, maxBackstopBps } = args;

    if (maxBackstopBps < 0 || maxBackstopBps > MAX_BACKSTOP_BPS) {
      throw new Error(
        `maxBackstopBps must be 0–${MAX_BACKSTOP_BPS}, got ${maxBackstopBps}`,
      );
    }

    const [configPda] = this.configPda(mint);

    // Instruction data: discriminator(8) + insurance_fund_pubkey(32) + max_backstop_bps(u16 LE)
    const data = Buffer.alloc(42);
    DISCRIMINATOR_SET_BACKSTOP_PARAMS.copy(data, 0);
    insuranceFundPubkey.toBuffer().copy(data, 8);
    data.writeUInt16LE(maxBackstopBps, 40);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  /**
   * Trigger the bad-debt backstop after a liquidation leaves collateral < debt.
   *
   * **NOTE**: This instruction is CPI-only on-chain — the config PDA must be the
   * signer, which means `trigger_backstop` can only be called by the `cdp_liquidate`
   * handler.  This SDK method is provided for simulation, local-validator testing,
   * and composable transaction building only.
   *
   * Draws `min(maxDraw, insuranceFundBalance)` from the insurance fund into the
   * reserve vault.  Emits `BadDebtTriggered`.
   *
   * BUG-031 fix: the shortfall is now computed entirely on-chain from the CDP
   * position and oracle price feed — callers no longer supply `shortfallAmount`.
   *
   * @param args.mint                   - The SSS-3 stablecoin mint.
   * @param args.cdpOwner               - CDP owner whose position has bad debt.
   * @param args.oraclePriceFeed        - Oracle price feed account.
   * @param args.oracleConsensus        - Optional OracleConsensus PDA (when FLAG_MULTI_ORACLE_CONSENSUS set).
   * @param args.insuranceFund          - Insurance fund token account (source).
   * @param args.reserveVault           - Reserve vault token account (destination).
   * @param args.collateralMint         - Collateral token mint.
   * @param args.insuranceFundAuthority - Signer authorising the insurance fund transfer.
   * @param args.collateralTokenProgram - Token program for collateral.
   * @returns Transaction signature.
   */
  async triggerBackstop(args: TriggerBackstopArgs): Promise<TransactionSignature> {
    const {
      mint,
      cdpOwner,
      oraclePriceFeed,
      insuranceFund,
      reserveVault,
      collateralMint,
      insuranceFundAuthority,
      collateralTokenProgram,
    } = args;

    const [configPda] = this.configPda(mint);

    // Derive CdpPosition PDA: ["cdp-position", mint, cdpOwner]
    const CDP_POSITION_SEED = Buffer.from('cdp-position');
    const [cdpPositionPda] = PublicKey.findProgramAddressSync(
      [CDP_POSITION_SEED, mint.toBuffer(), cdpOwner.toBuffer()],
      this.programId,
    );

    // Derive CollateralVault PDA: ["cdp-collateral-vault", mint, cdpOwner, collateralMint]
    const COLLATERAL_VAULT_SEED = Buffer.from('cdp-collateral-vault');
    const [collateralVaultPda] = PublicKey.findProgramAddressSync(
      [COLLATERAL_VAULT_SEED, mint.toBuffer(), cdpOwner.toBuffer(), collateralMint.toBuffer()],
      this.programId,
    );

    // Instruction data: discriminator(8) + cdp_owner Pubkey (32 bytes)
    const data = Buffer.alloc(40);
    DISCRIMINATOR_TRIGGER_BACKSTOP.copy(data, 0);
    cdpOwner.toBuffer().copy(data, 8);

    // Build account keys in the order defined by TriggerBackstop<'info>
    const keys = [
      { pubkey: configPda, isSigner: true, isWritable: false },              // liquidation_authority (config PDA)
      { pubkey: configPda, isSigner: false, isWritable: true },              // config (mut)
      { pubkey: mint, isSigner: false, isWritable: false },                  // sss_mint
      { pubkey: cdpPositionPda, isSigner: false, isWritable: false },        // cdp_position
      { pubkey: collateralVaultPda, isSigner: false, isWritable: false },    // collateral_vault
      { pubkey: collateralMint, isSigner: false, isWritable: false },        // collateral_mint
      { pubkey: oraclePriceFeed, isSigner: false, isWritable: false },       // oracle_price_feed
      { pubkey: insuranceFund, isSigner: false, isWritable: true },          // insurance_fund (mut)
      { pubkey: reserveVault, isSigner: false, isWritable: true },           // reserve_vault (mut)
      { pubkey: insuranceFundAuthority, isSigner: true, isWritable: false }, // insurance_fund_authority
      { pubkey: collateralTokenProgram, isSigner: false, isWritable: false },// collateral_token_program
    ];

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Read helpers ─────────────────────────────────────────────────────────

  /**
   * Fetch the backstop configuration from `StablecoinConfig`.
   *
   * Reads `insurance_fund_pubkey` (Pubkey, 32 bytes) and `max_backstop_bps`
   * (u16) from the raw account data.
   *
   * @param mint - The stablecoin mint.
   * @returns {@link BackstopConfig} with the current backstop settings.
   */
  async fetchBackstopConfig(mint: PublicKey): Promise<BackstopConfig> {
    const [configPda] = this.configPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(configPda);
    if (!accountInfo) {
      throw new Error(`StablecoinConfig PDA not found for mint ${mint.toBase58()}`);
    }

    const data = accountInfo.data;

    // StablecoinConfig layout with SSS-097 fields appended at tail:
    //   ... (existing fields)
    //   [-1]    bump: u8
    //   [-3..-1] max_oracle_conf_bps: u16 LE (SSS-090)
    //   [-7..-3] max_oracle_age_secs: u32 LE (SSS-090)
    //   [-9..-7] redemption_fee_bps: u16 LE  (SSS-093)
    //   [-11..-9] stability_fee_bps: u16 LE  (SSS-092)
    //   [-13..-11] max_backstop_bps: u16 LE  (SSS-097)
    //   [-45..-13] insurance_fund_pubkey: [u8;32] (SSS-097)
    const len = data.length;
    const maxBackstopBps = data.readUInt16LE(len - 13);
    const insuranceFundBytes = data.slice(len - 45, len - 13);
    const insuranceFundPubkey = new PublicKey(insuranceFundBytes);

    const defaultPubkey = PublicKey.default;
    const enabled = !insuranceFundPubkey.equals(defaultPubkey);

    return { insuranceFundPubkey, maxBackstopBps, enabled };
  }

  /**
   * Returns `true` when the backstop is currently enabled for a mint.
   * (i.e. `insurance_fund_pubkey` is not the default zero pubkey)
   */
  async isBackstopEnabled(mint: PublicKey): Promise<boolean> {
    const config = await this.fetchBackstopConfig(mint);
    return config.enabled;
  }

  // ─── Off-chain compute helpers ────────────────────────────────────────────

  /**
   * Compute the maximum backstop draw given on-chain parameters.
   *
   * Replicates the on-chain logic from `trigger_backstop_handler`:
   * ```
   * max_draw = if max_backstop_bps == 0 {
   *   shortfall
   * } else {
   *   min(net_supply * max_backstop_bps / 10_000, shortfall)
   * }
   * actual_draw = min(max_draw, insurance_fund_balance)
   * ```
   *
   * @param params.netSupply          - Total outstanding debt (net_supply).
   * @param params.maxBackstopBps     - Max draw cap in bps (0 = unlimited).
   * @param params.shortfall          - Post-liquidation shortfall amount.
   * @param params.insuranceFundBalance - Available insurance fund balance.
   * @returns The estimated backstop draw amount.
   */
  computeMaxDraw(params: {
    netSupply: bigint;
    maxBackstopBps: number;
    shortfall: bigint;
    insuranceFundBalance?: bigint;
  }): bigint {
    const { netSupply, maxBackstopBps, shortfall, insuranceFundBalance } = params;

    const maxDrawBeforeFund =
      maxBackstopBps === 0
        ? shortfall
        : BigInt(maxBackstopBps) > 0n
          ? (netSupply * BigInt(maxBackstopBps)) / 10_000n < shortfall
            ? (netSupply * BigInt(maxBackstopBps)) / 10_000n
            : shortfall
          : shortfall;

    if (insuranceFundBalance !== undefined) {
      return maxDrawBeforeFund < insuranceFundBalance
        ? maxDrawBeforeFund
        : insuranceFundBalance;
    }
    return maxDrawBeforeFund;
  }

  /**
   * Compute the remaining shortfall after a backstop draw.
   *
   * @param shortfall   - Original shortfall.
   * @param backstopDraw - Amount drawn from insurance fund.
   * @returns Remaining shortfall (0 if fully covered).
   */
  computeRemainingShortfall(shortfall: bigint, backstopDraw: bigint): bigint {
    return shortfall > backstopDraw ? shortfall - backstopDraw : 0n;
  }

  // ─── SSS-100: Insurance fund management ──────────────────────────────────

  /**
   * Contribute collateral tokens to the insurance fund (backstop vault).
   *
   * Builds and sends an SPL token transfer from the contributor's source account
   * into the configured insurance fund token account.  The insurance fund pubkey
   * must already be set via {@link setBackstopParams}.
   *
   * This is an **off-chain-orchestrated** deposit: the contributor signs the
   * SPL token transfer directly.  No additional on-chain SSS instruction is
   * required since the insurance fund is an externally-managed token account.
   *
   * @param args.insuranceFund          - Destination: the configured insurance fund token account.
   * @param args.sourceTokenAccount     - Source: contributor's collateral token account.
   * @param args.contributor            - Contributor's public key (must sign).
   * @param args.collateralMint         - Collateral token mint.
   * @param args.collateralDecimals     - Decimals of the collateral mint.
   * @param args.amount                 - Amount to deposit (native units, must be > 0).
   * @param args.tokenProgram           - Token program (default: TOKEN_PROGRAM_ID).
   * @returns Transaction signature.
   * @throws When amount is 0 or negative.
   */
  async contributeToBackstop(args: ContributeToBackstopArgs): Promise<TransactionSignature> {
    const {
      insuranceFund,
      sourceTokenAccount,
      contributor,
      collateralMint,
      collateralDecimals,
      amount,
      tokenProgram = TOKEN_PROGRAM_ID,
    } = args;

    if (amount <= 0n) {
      throw new Error('contributeToBackstop: amount must be greater than zero');
    }

    // Build SPL transfer_checked instruction.
    const transferIx = this._buildTransferCheckedIx({
      source: sourceTokenAccount,
      destination: insuranceFund,
      authority: contributor,
      mint: collateralMint,
      amount,
      decimals: collateralDecimals,
      tokenProgram,
    });

    const tx = new Transaction().add(transferIx);
    return this.provider.sendAndConfirm(tx, []);
  }

  /**
   * Withdraw collateral tokens from the insurance fund (backstop vault).
   *
   * Builds and sends an SPL token transfer from the insurance fund to a
   * destination account.  The insurance fund authority must sign.
   *
   * @param args.insuranceFund              - Source: insurance fund token account.
   * @param args.insuranceFundAuthority     - Authority that controls the insurance fund.
   * @param args.destinationTokenAccount    - Destination token account.
   * @param args.collateralMint             - Collateral token mint.
   * @param args.collateralDecimals         - Decimals of the collateral mint.
   * @param args.amount                     - Amount to withdraw (native units, must be > 0).
   * @param args.tokenProgram               - Token program (default: TOKEN_PROGRAM_ID).
   * @returns Transaction signature.
   * @throws When amount is 0 or negative.
   */
  async withdrawFromBackstop(args: WithdrawFromBackstopArgs): Promise<TransactionSignature> {
    const {
      insuranceFund,
      insuranceFundAuthority,
      destinationTokenAccount,
      collateralMint,
      collateralDecimals,
      amount,
      tokenProgram = TOKEN_PROGRAM_ID,
    } = args;

    if (amount <= 0n) {
      throw new Error('withdrawFromBackstop: amount must be greater than zero');
    }

    const transferIx = this._buildTransferCheckedIx({
      source: insuranceFund,
      destination: destinationTokenAccount,
      authority: insuranceFundAuthority,
      mint: collateralMint,
      amount,
      decimals: collateralDecimals,
      tokenProgram,
    });

    const tx = new Transaction().add(transferIx);
    return this.provider.sendAndConfirm(tx, []);
  }

  /**
   * Trigger bad-debt socialization — alias for {@link triggerBackstop}.
   *
   * Maps to the on-chain `trigger_backstop` instruction which draws collateral
   * from the insurance fund to cover a post-liquidation shortfall.  Use this
   * alias when integrating SSS-100 socialization flows.
   *
   * @param args - Same as {@link TriggerBackstopArgs}.
   * @returns Transaction signature.
   */
  async triggerBadDebtSocialization(
    args: TriggerBadDebtSocializationArgs,
  ): Promise<TransactionSignature> {
    return this.triggerBackstop(args);
  }

  /**
   * Fetch live backstop fund state: config parameters + current fund balance.
   *
   * Reads the `StablecoinConfig` PDA to get `insurance_fund_pubkey` and
   * `max_backstop_bps`, then fetches the insurance fund token account to
   * retrieve its current balance and mint.
   *
   * @param mint - The stablecoin mint.
   * @returns {@link BackstopFundState} with config + live balance.
   * @throws When the insurance fund account is not found or backstop is disabled.
   */
  async fetchBackstopFundState(mint: PublicKey): Promise<BackstopFundState> {
    const config = await this.fetchBackstopConfig(mint);

    if (!config.enabled) {
      return {
        ...config,
        fundBalance: 0n,
        fundMint: PublicKey.default,
      };
    }

    // Fetch the insurance fund token account.
    const fundAccountInfo = await this.provider.connection.getAccountInfo(
      config.insuranceFundPubkey,
    );
    if (!fundAccountInfo) {
      throw new Error(
        `Insurance fund token account not found: ${config.insuranceFundPubkey.toBase58()}`,
      );
    }

    // SPL token account layout: amount at offset 64 (u64 LE), mint at offset 0 (Pubkey).
    const fundData = fundAccountInfo.data;
    const fundMint = new PublicKey(fundData.slice(0, 32));
    const fundBalance = fundData.readBigUInt64LE(64);

    return {
      insuranceFundPubkey: config.insuranceFundPubkey,
      maxBackstopBps: config.maxBackstopBps,
      enabled: config.enabled,
      fundBalance,
      fundMint,
    };
  }

  /**
   * Compute the coverage ratio of the insurance fund.
   *
   * Returns the ratio of fund balance to net supply as a fraction (0.0–N).
   * A ratio ≥ 1.0 means the fund can cover the full net supply shortfall.
   *
   * @param fundBalance - Current insurance fund balance (native units).
   * @param netSupply   - Outstanding stablecoin supply / total debt (native units).
   * @returns Coverage ratio as a number (0.0 when netSupply = 0).
   */
  computeCoverageRatio(fundBalance: bigint, netSupply: bigint): number {
    if (netSupply === 0n) return 0;
    return Number(fundBalance) / Number(netSupply);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Build a `transfer_checked` SPL instruction manually, avoiding a full
   * @solana/spl-token import dependency.
   *
   * transfer_checked instruction layout:
   *   [0]      instruction index: 12 (u8)
   *   [1..8]   amount: u64 LE
   *   [9]      decimals: u8
   */
  private _buildTransferCheckedIx(params: {
    source: PublicKey;
    destination: PublicKey;
    authority: PublicKey;
    mint: PublicKey;
    amount: bigint;
    decimals: number;
    tokenProgram: PublicKey;
  }): TransactionInstruction {
    const { source, destination, authority, mint, amount, decimals, tokenProgram } = params;

    const data = Buffer.alloc(10);
    data.writeUInt8(12, 0); // transfer_checked instruction index
    data.writeBigUInt64LE(amount, 1);
    data.writeUInt8(decimals, 9);

    return new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
      data,
    });
  }
}
