/**
 * SSS-101: MultiCollateralLiquidationModule
 *
 * TypeScript SDK for the multi-collateral liquidation engine (SSS-100).
 *
 * When SSS-100 anchor is merged, the on-chain `cdp_liquidate` instruction gains:
 *   - `collateral_mint` param — liquidator specifies which collateral to seize
 *   - `partial_amount` param — liquidator may repay only enough debt to restore health
 *   - `CollateralLiquidated` event emitted with collateral_mint field
 *
 * Until SSS-100 IDL is live this module exposes:
 *   - PDA helpers and type definitions
 *   - `calcLiquidationAmount`  — pure math helper (no RPC)
 *   - `fetchLiquidatableCDPs`  — scans on-chain positions and returns liquidatable ones
 *   - `liquidate`              — wraps the new cdp_liquidate instruction
 *
 * @module MultiCollateralLiquidationModule
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

// ─── Seeds (mirrors on-chain program) ────────────────────────────────────────

export const CDP_POSITION_SEED = Buffer.from('cdp-position');
export const COLLATERAL_VAULT_SEED = Buffer.from('cdp-collateral-vault');
export const COLLATERAL_CONFIG_SEED = Buffer.from('collateral-config');
export const STABLECOIN_CONFIG_SEED = Buffer.from('stablecoin-config');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Liquidation threshold: 12 000 bps = 120% */
export const LIQUIDATION_THRESHOLD_BPS = 12_000;
/** Default liquidation bonus if no CollateralConfig is set: 500 bps = 5% */
export const DEFAULT_LIQUIDATION_BONUS_BPS = 500;
/** BPS denominator */
export const BPS_DENOMINATOR = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Represents a CDP position that is eligible for liquidation.
 */
export interface LiquidatableCDP {
  /** On-chain CDP position PDA */
  cdpPositionPda: PublicKey;
  /** Owner wallet of the undercollateralised position */
  owner: PublicKey;
  /** SSS-3 stablecoin mint */
  sssMint: PublicKey;
  /** Collateral mint locked in this position */
  collateralMint: PublicKey;
  /** Outstanding debt in SSS base units */
  debtAmount: bigint;
  /** Accrued stability fees in SSS base units */
  accruedFees: bigint;
  /** Total debt incl. fees */
  totalDebt: bigint;
  /** Deposited collateral in collateral native units */
  collateralDeposited: bigint;
  /** USD price of 1 collateral native unit (6 decimals assumed) */
  collateralPriceUsd: number;
  /** Current collateral-to-debt ratio in basis points */
  currentRatioBps: number;
  /** Whether this position is liquidatable (ratioBps < liquidationThresholdBps) */
  isLiquidatable: boolean;
  /**
   * Maximum collateral that could be seized while restoring the position
   * to min-collateral ratio (partial liquidation amount).
   */
  maxPartialCollateral: bigint;
}

/**
 * Parameters for `liquidate`.
 */
export interface LiquidateParams {
  /** SSS-3 stablecoin mint */
  sssMint: PublicKey;
  /** Owner of the position being liquidated */
  cdpOwner: PublicKey;
  /** Collateral mint the liquidator wants to seize */
  collateralMint: PublicKey;
  /** Pyth price feed account for the collateral mint */
  pythPriceFeed: PublicKey;
  /** Minimum collateral tokens the liquidator expects to receive (slippage guard). 0 = disabled. */
  minCollateralAmount: bigint;
  /**
   * SSS tokens to burn (SSS-100 cdp_liquidate_v2 `debt_to_repay` arg).
   * 0n = full liquidation (burns all outstanding debt).
   * >0n = partial liquidation (burns exactly this amount; position must be healthy after).
   * Defaults to 0n (full liquidation).
   */
  debtToRepay?: bigint;
  /** Whether the collateral mint uses Token-2022 (default: false = Token). */
  collateralIsToken2022?: boolean;
  /** Liquidator's SSS ATA (defaults to derived ATA). */
  liquidatorSssAccount?: PublicKey;
  /** Liquidator's collateral ATA (defaults to derived ATA). */
  liquidatorCollateralAccount?: PublicKey;
}

/**
 * Parameters for `calcLiquidationAmount`.
 * All BPS values are in basis points (10_000 = 100%).
 */
export interface CalcLiquidationParams {
  /** Total outstanding debt including fees (in SSS base units, 6 decimals) */
  totalDebtUnits: bigint;
  /** Deposited collateral in collateral native units */
  collateralUnits: bigint;
  /** USD price per collateral native unit (multiply by units → USD, 6 decimals assumed) */
  collateralPriceUsd: number;
  /** Collateral decimals (default 6) */
  collateralDecimals?: number;
  /** SSS token decimals (default 6) */
  sssDecimals?: number;
  /** Liquidation bonus in basis points (default DEFAULT_LIQUIDATION_BONUS_BPS) */
  liquidationBonusBps?: number;
}

/**
 * Typed representation of the on-chain `CollateralLiquidated` event (SSS-100).
 *
 * Emitted by `cdp_liquidate_v2` on every successful liquidation.
 * Field names mirror the Anchor event struct in `events.rs`.
 */
export interface CollateralLiquidatedEvent {
  /** SSS stablecoin mint */
  mint: PublicKey;
  /** Collateral mint that was seized */
  collateralMint: PublicKey;
  /** CDP owner whose position was (partially) liquidated */
  cdpOwner: PublicKey;
  /** Liquidator who initiated the liquidation */
  liquidator: PublicKey;
  /** Amount of SSS debt burned */
  debtBurned: bigint;
  /** Amount of collateral transferred to the liquidator */
  collateralSeized: bigint;
  /** Collateral ratio before liquidation (basis points) */
  ratioBeforeBps: bigint;
  /** Whether this was a partial liquidation */
  partial: boolean;
  /** Liquidation bonus applied (basis points) */
  bonusBps: number;
}

/**
 * Result of `calcLiquidationAmount`.
 */
export interface LiquidationAmountResult {
  /** Amount of SSS tokens to burn for a full liquidation */
  fullDebtToBurn: bigint;
  /** Collateral seized in a full liquidation (before bonus) */
  fullCollateralSeized: bigint;
  /** Bonus collateral the liquidator receives on top */
  liquidationBonus: bigint;
  /** Total collateral transferred to liquidator (seized + bonus) */
  totalCollateralToLiquidator: bigint;
  /**
   * Debt amount to burn for a *partial* liquidation that restores the position
   * to exactly the minimum collateral ratio.
   * 0n when the position is already healthy.
   */
  partialDebtToBurn: bigint;
  /**
   * Collateral seized in the partial path.
   */
  partialCollateralSeized: bigint;
}

// ─── PDA Helpers ─────────────────────────────────────────────────────────────

/**
 * Derive the CDP position PDA.
 *
 * Seeds: ["cdp-position", sssMint, owner]
 */
export function deriveCdpPositionPda(
  sssMint: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CDP_POSITION_SEED, sssMint.toBuffer(), owner.toBuffer()],
    programId,
  );
}

/**
 * Derive the CollateralVault PDA.
 *
 * Seeds: ["cdp-collateral-vault", sssMint, owner, collateralMint]
 */
export function deriveCollateralVaultPda(
  sssMint: PublicKey,
  owner: PublicKey,
  collateralMint: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      COLLATERAL_VAULT_SEED,
      sssMint.toBuffer(),
      owner.toBuffer(),
      collateralMint.toBuffer(),
    ],
    programId,
  );
}

/**
 * Derive the CollateralConfig PDA.
 *
 * Seeds: ["collateral-config", sssMint, collateralMint]
 */
export function deriveCollateralConfigPda(
  sssMint: PublicKey,
  collateralMint: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      COLLATERAL_CONFIG_SEED,
      sssMint.toBuffer(),
      collateralMint.toBuffer(),
    ],
    programId,
  );
}

/**
 * Derive the StablecoinConfig PDA.
 *
 * Seeds: ["stablecoin-config", sssMint]
 */
export function deriveStablecoinConfigPda(
  sssMint: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STABLECOIN_CONFIG_SEED, sssMint.toBuffer()],
    programId,
  );
}

// ─── Pure Math ────────────────────────────────────────────────────────────────

/**
 * Calculate liquidation amounts for a given CDP position.
 *
 * This is a pure utility — it does NOT call the network.
 * Use it to simulate how much to pass as `minCollateralAmount` or `partialDebtAmount`.
 *
 * @example
 * ```ts
 * const result = calcLiquidationAmount({
 *   totalDebtUnits: 1_000_000n,    // 1 SSS (6 decimals)
 *   collateralUnits: 1_500_000n,   // 1.5 SOL (6 decimals)
 *   collateralPriceUsd: 100.0,     // $100 per SOL
 *   liquidationBonusBps: 500,       // 5%
 * });
 * // result.fullDebtToBurn === 1_000_000n
 * // result.totalCollateralToLiquidator === some bigint
 * ```
 */
export function calcLiquidationAmount(
  params: CalcLiquidationParams,
): LiquidationAmountResult {
  const {
    totalDebtUnits,
    collateralUnits,
    collateralPriceUsd,
    collateralDecimals = 6,
    sssDecimals = 6,
    liquidationBonusBps = DEFAULT_LIQUIDATION_BONUS_BPS,
  } = params;

  const collateralScale = 10 ** collateralDecimals;
  const sssScale = 10 ** sssDecimals;

  // Collateral value in USD (as float)
  const collateralValueUsd =
    (Number(collateralUnits) / collateralScale) * collateralPriceUsd;
  const debtValueUsd = Number(totalDebtUnits) / sssScale;

  // ── Full liquidation ──────────────────────────────────────────────────────
  const fullDebtToBurn = totalDebtUnits;

  // Collateral owed = debt / price, expressed in collateral native units
  const collateralPerUsd = collateralScale / collateralPriceUsd;
  const rawSeized = Math.floor(debtValueUsd * collateralPerUsd);
  const fullCollateralSeized = BigInt(rawSeized);

  const bonus = BigInt(
    Math.floor(
      (Number(fullCollateralSeized) * liquidationBonusBps) / BPS_DENOMINATOR,
    ),
  );
  const liquidationBonus = bonus;
  const totalCollateralToLiquidator =
    fullCollateralSeized + liquidationBonus <= collateralUnits
      ? fullCollateralSeized + liquidationBonus
      : collateralUnits; // capped at vault balance

  // ── Partial liquidation ───────────────────────────────────────────────────
  // Minimum healthy ratio: 15 000 bps = 150%
  const MIN_RATIO_BPS = 15_000;

  // Current ratio in bps
  const currentRatioBps =
    debtValueUsd > 0
      ? Math.floor((collateralValueUsd / debtValueUsd) * BPS_DENOMINATOR)
      : Number.MAX_SAFE_INTEGER;

  let partialDebtToBurn = 0n;
  let partialCollateralSeized = 0n;

  if (currentRatioBps < LIQUIDATION_THRESHOLD_BPS) {
    // How much debt must be burned to restore the position to MIN_RATIO_BPS?
    // collateralValueUsd >= targetRatio * (debt - debtBurned) / BPS
    // => debtBurned >= debt - collateralValueUsd * BPS / targetRatio
    const targetDebtUsd =
      (collateralValueUsd * BPS_DENOMINATOR) / MIN_RATIO_BPS;
    const debtToBurnUsd = Math.max(0, debtValueUsd - targetDebtUsd);
    const debtToBurnUnits = BigInt(Math.ceil(debtToBurnUsd * sssScale));
    partialDebtToBurn =
      debtToBurnUnits < totalDebtUnits ? debtToBurnUnits : totalDebtUnits;

    const partialRawSeized = Math.floor(debtToBurnUsd * collateralPerUsd);
    const partialBonus = Math.floor(
      (partialRawSeized * liquidationBonusBps) / BPS_DENOMINATOR,
    );
    const total = BigInt(partialRawSeized + partialBonus);
    partialCollateralSeized =
      total <= collateralUnits ? total : collateralUnits;
  }

  return {
    fullDebtToBurn,
    fullCollateralSeized,
    liquidationBonus,
    totalCollateralToLiquidator,
    partialDebtToBurn,
    partialCollateralSeized,
  };
}

// ─── Module Class ─────────────────────────────────────────────────────────────

/**
 * MultiCollateralLiquidationModule — SDK wrapper for SSS-100.
 *
 * Requires a loaded `Program` instance from `@coral-xyz/anchor` and
 * an `AnchorProvider` with a signer wallet.
 *
 * @example
 * ```ts
 * import { MultiCollateralLiquidationModule } from './MultiCollateralLiquidationModule';
 * import { Program, AnchorProvider } from '@coral-xyz/anchor';
 *
 * const mod = new MultiCollateralLiquidationModule(program, provider);
 * const liquidatable = await mod.fetchLiquidatableCDPs(sssMint, priceFeedMap);
 * for (const cdp of liquidatable) {
 *   const sig = await mod.liquidate({
 *     sssMint,
 *     cdpOwner: cdp.owner,
 *     collateralMint: cdp.collateralMint,
 *     pythPriceFeed: priceFeedMap[cdp.collateralMint.toBase58()],
 *     minCollateralAmount: 0n,
 *   });
 * }
 * ```
 */
export class MultiCollateralLiquidationModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly program: Program<any>,
    private readonly provider: AnchorProvider,
  ) {}

  /** The on-chain program ID for PDA derivation. */
  get programId(): PublicKey {
    return this.program.programId;
  }

  // ── PDA convenience wrappers ──────────────────────────────────────────────

  cdpPositionPda(sssMint: PublicKey, owner: PublicKey): PublicKey {
    return deriveCdpPositionPda(sssMint, owner, this.programId)[0];
  }

  collateralVaultPda(
    sssMint: PublicKey,
    owner: PublicKey,
    collateralMint: PublicKey,
  ): PublicKey {
    return deriveCollateralVaultPda(sssMint, owner, collateralMint, this.programId)[0];
  }

  collateralConfigPda(sssMint: PublicKey, collateralMint: PublicKey): PublicKey {
    return deriveCollateralConfigPda(sssMint, collateralMint, this.programId)[0];
  }

  // ── fetchLiquidatableCDPs ─────────────────────────────────────────────────

  /**
   * Fetch all CDP positions for a given SSS-3 mint and return those that are
   * below the liquidation threshold.
   *
   * `priceFeedMap` — a map from collateral mint base58 → current USD price.
   * In production this would be populated from Pyth Hermes or a cached feed.
   *
   * @param sssMint   The SSS-3 stablecoin mint.
   * @param priceFeedMap  Map of collateralMint.toBase58() → USD price per native unit.
   * @returns Array of `LiquidatableCDP`, sorted by health (worst first).
   */
  async fetchLiquidatableCDPs(
    sssMint: PublicKey,
    priceFeedMap: Record<string, number>,
  ): Promise<LiquidatableCDP[]> {
    // Fetch all CdpPosition accounts for this sssMint
    const positions = await this.program.account['cdpPosition'].all([
      {
        memcmp: {
          offset: 8 + 32, // discriminator(8) + config pubkey(32) → sssMint at offset 40
          bytes: sssMint.toBase58(),
        },
      },
    ]);

    const results: LiquidatableCDP[] = [];

    for (const pos of positions) {
      const account = pos.account as {
        sss_mint: PublicKey;
        owner: PublicKey;
        debt_amount: BN;
        accrued_fees: BN;
        collateral_mint: PublicKey;
      };

      const owner = account.owner;
      const collateralMint = account.collateral_mint;
      const debtAmount = BigInt(account.debt_amount.toString());
      const accruedFees = BigInt(account.accrued_fees.toString());
      const totalDebt = debtAmount + accruedFees;

      if (totalDebt === 0n) continue; // no debt — not liquidatable

      const priceKey = collateralMint.toBase58();
      const collateralPriceUsd = priceFeedMap[priceKey];
      if (collateralPriceUsd === undefined) continue; // no price feed — skip

      // Fetch vault balance
      const vaultPda = this.collateralVaultPda(sssMint, owner, collateralMint);
      let collateralDeposited = 0n;
      try {
        const vault = await this.program.account['collateralVault'].fetch(vaultPda);
        collateralDeposited = BigInt(
          (vault as { deposited_amount: BN }).deposited_amount.toString(),
        );
      } catch {
        // vault may not exist yet — skip
        continue;
      }

      // Calculate ratio
      const debtUsd = Number(totalDebt) / 1e6;
      const collateralUsd = (Number(collateralDeposited) / 1e6) * collateralPriceUsd;
      const currentRatioBps =
        debtUsd > 0
          ? Math.floor((collateralUsd / debtUsd) * BPS_DENOMINATOR)
          : BPS_DENOMINATOR * 999;

      const isLiquidatable = currentRatioBps < LIQUIDATION_THRESHOLD_BPS;

      const { partialCollateralSeized } = calcLiquidationAmount({
        totalDebtUnits: totalDebt,
        collateralUnits: collateralDeposited,
        collateralPriceUsd,
      });

      results.push({
        cdpPositionPda: pos.publicKey,
        owner,
        sssMint,
        collateralMint,
        debtAmount,
        accruedFees,
        totalDebt,
        collateralDeposited,
        collateralPriceUsd,
        currentRatioBps,
        isLiquidatable,
        maxPartialCollateral: partialCollateralSeized,
      });
    }

    // Return all positions but sort liquidatable ones first (worst health first)
    return results
      .filter((r) => r.isLiquidatable)
      .sort((a, b) => a.currentRatioBps - b.currentRatioBps);
  }

  // ── liquidate ─────────────────────────────────────────────────────────────

  /**
   * Execute liquidation of an undercollateralised CDP position.
   *
   * Wraps the on-chain `cdp_liquidate_v2` instruction (SSS-100).
   *
   * @param params  See `LiquidateParams`.
   * @returns Transaction signature.
   */
  async liquidate(params: LiquidateParams): Promise<TransactionSignature> {
    const {
      sssMint,
      cdpOwner,
      collateralMint,
      pythPriceFeed,
      minCollateralAmount,
      debtToRepay = 0n,
      collateralIsToken2022 = false,
      liquidatorSssAccount,
      liquidatorCollateralAccount,
    } = params;

    const liquidator = this.provider.wallet.publicKey;

    const [configPda] = deriveStablecoinConfigPda(sssMint, this.programId);
    const [cdpPositionPda] = deriveCdpPositionPda(sssMint, cdpOwner, this.programId);
    const [collateralVaultPda] = deriveCollateralVaultPda(
      sssMint,
      cdpOwner,
      collateralMint,
      this.programId,
    );
    const [collateralConfigPda] = deriveCollateralConfigPda(
      sssMint,
      collateralMint,
      this.programId,
    );

    // Derive vault token account (owned by collateralVaultPda)
    const collateralTokenProgram = collateralIsToken2022
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      collateralMint,
      collateralVaultPda,
      true,
      collateralTokenProgram,
    );

    const liquidatorSss =
      liquidatorSssAccount ??
      getAssociatedTokenAddressSync(sssMint, liquidator, false, TOKEN_2022_PROGRAM_ID);

    const liquidatorCollateral =
      liquidatorCollateralAccount ??
      getAssociatedTokenAddressSync(
        collateralMint,
        liquidator,
        false,
        collateralTokenProgram,
      );

    // SSS-100: cdp_liquidate_v2(debt_to_repay: u64, min_collateral_amount: u64)
    return this.program.methods
      .cdpLiquidateV2(
        new BN(debtToRepay.toString()),
        new BN(minCollateralAmount.toString()),
      )
      .accountsPartial({
        liquidator,
        config: configPda,
        sssMint,
        liquidatorSssAccount: liquidatorSss,
        cdpPosition: cdpPositionPda,
        cdpOwner,
        collateralVault: collateralVaultPda,
        collateralMint,
        vaultTokenAccount,
        liquidatorCollateralAccount: liquidatorCollateral,
        collateralConfig: collateralConfigPda,
        pythPriceFeed,
        sssTokenProgram: TOKEN_2022_PROGRAM_ID,
        collateralTokenProgram,
      })
      .rpc();
  }

  // ── Event parsing ─────────────────────────────────────────────────────────

  /**
   * Parse a `CollateralLiquidated` event from an Anchor program event listener
   * or `getParsedTransaction` log output.
   *
   * Usage with Anchor event listener:
   * ```ts
   * program.addEventListener('CollateralLiquidated', (raw) => {
   *   const evt = mod.parseCollateralLiquidatedEvent(raw);
   *   console.log('liquidated', evt.cdpOwner.toBase58(), 'debtBurned', evt.debtBurned);
   * });
   * ```
   *
   * @param raw   The raw event object emitted by the Anchor listener.
   * @returns     A strongly-typed `CollateralLiquidatedEvent`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseCollateralLiquidatedEvent(raw: any): CollateralLiquidatedEvent {
    return {
      mint: raw.mint instanceof PublicKey ? raw.mint : new PublicKey(raw.mint),
      collateralMint:
        raw.collateralMint instanceof PublicKey
          ? raw.collateralMint
          : new PublicKey(raw.collateralMint),
      cdpOwner:
        raw.cdpOwner instanceof PublicKey
          ? raw.cdpOwner
          : new PublicKey(raw.cdpOwner),
      liquidator:
        raw.liquidator instanceof PublicKey
          ? raw.liquidator
          : new PublicKey(raw.liquidator),
      debtBurned: BigInt(raw.debtBurned?.toString() ?? raw.debt_burned?.toString() ?? '0'),
      collateralSeized: BigInt(
        raw.collateralSeized?.toString() ?? raw.collateral_seized?.toString() ?? '0',
      ),
      ratioBeforeBps: BigInt(
        raw.ratioBeforeBps?.toString() ?? raw.ratio_before_bps?.toString() ?? '0',
      ),
      partial: Boolean(raw.partial),
      bonusBps: Number(raw.bonusBps ?? raw.bonus_bps ?? 0),
    };
  }

  // ── Convenience re-exports ────────────────────────────────────────────────

  /** Pure math helper — does not call the network. */
  calcLiquidationAmount = calcLiquidationAmount;
}
