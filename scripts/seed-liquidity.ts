/**
 * SSS AMM Integration Helpers — seed-liquidity.ts
 *
 * Provides TypeScript tooling for seeding initial AMM liquidity for SSS stablecoins.
 * Supports Orca Whirlpools (concentrated liquidity) and Raydium CLMM pools.
 *
 * @module seed-liquidity
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
} from "@solana/spl-token";
import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Orca Whirlpools
// ---------------------------------------------------------------------------
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  TickUtil,
  increaseLiquidityQuoteByInputTokenWithParams,
  TokenExtensionContextForPool,
  NO_TOKEN_EXTENSION_CONTEXT,
  WhirlpoolIx,
  InitPoolParams,
} from "@orca-so/whirlpools-sdk";
import { AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";

// ---------------------------------------------------------------------------
// Raydium CLMM
// ---------------------------------------------------------------------------
import { Raydium, ClmmKeys, ApiV3PoolInfoConcentratedItem } from "@raydium-io/raydium-sdk-v2";

// ---------------------------------------------------------------------------
// Types & Config
// ---------------------------------------------------------------------------

/** Configuration for seeding an Orca Whirlpool position */
export interface OrcaPoolConfig {
  /** RPC connection */
  connection: Connection;
  /** Wallet / payer keypair */
  wallet: Keypair;
  /** SSS stablecoin mint (assumed 6 decimals, stable at $1.00) */
  sstMint: PublicKey;
  /** Quote mint — typically USDC */
  usdcMint: PublicKey;
  /** Whirlpool config address (devnet / mainnet) */
  whirlpoolConfig: PublicKey;
  /** Amount of SST to provide as liquidity (in lamports / raw units) */
  sstAmountRaw: BN;
  /** Tick spacing — 1 = tightest range, 64 = standard, 128 = wide */
  tickSpacing?: number;
  /** Half-width in ticks around the 1:1 price point (default: 10 ticks = ~0.1% range) */
  tickRangeHalfWidth?: number;
}

/** Configuration for seeding a Raydium CLMM pool */
export interface RaydiumPoolConfig {
  /** RPC connection */
  connection: Connection;
  /** Wallet / payer keypair */
  wallet: Keypair;
  /** SSS stablecoin mint */
  sstMint: PublicKey;
  /** Quote mint (USDC) */
  usdcMint: PublicKey;
  /** Amount of SST to provide (raw) */
  sstAmountRaw: BN;
  /** Initial sqrt price (X64 format) — defaults to 1:1 peg */
  initialSqrtPriceX64?: BN;
}

/** Result from seedOrcaPool / seedRaydiumPool */
export interface SeedResult {
  /** Transaction signature */
  txSig: string;
  /** Pool / position address */
  positionMint?: PublicKey;
  /** Human-readable summary */
  summary: string;
}

/** Pool health status returned by checkPoolHealth */
export interface PoolHealth {
  poolAddress: PublicKey;
  /** Current pool price (token A per token B) */
  currentPrice: Decimal;
  /** Peg deviation in basis points (|price - 1.0| * 10_000) */
  pegDeviationBps: number;
  /** Price impact in bps for a $1k swap */
  priceImpactBps1k: number;
  /** Available liquidity depth in quote tokens */
  depthQuote: Decimal;
  /** Whether the pool is within acceptable peg bounds */
  healthy: boolean;
  /** ISO timestamp of the check */
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum peg deviation (50 bps = 0.5%) before pool is flagged unhealthy */
export const MAX_PEG_DEVIATION_BPS = 50;

/** Default tick spacing for SSS/USDC pools (tight, concentrated) */
export const DEFAULT_TICK_SPACING = 1;

/** Default tick range half-width — covers ±0.01% around peg at spacing=1 */
export const DEFAULT_TICK_RANGE_HALF_WIDTH = 10;

/** Sqrt price for 1:1 ratio (Q64.64 format) */
const SQRT_PRICE_1_TO_1 = new BN("18446744073709551616"); // 2^64

// ---------------------------------------------------------------------------
// Orca Pool Seeding
// ---------------------------------------------------------------------------

/**
 * Seeds an Orca Whirlpool concentrated liquidity position for an SSS/USDC pair
 * at a 1:1 peg with a tight price range.
 *
 * The function will:
 *   1. Derive or create the Whirlpool for (sstMint, usdcMint, tickSpacing)
 *   2. Open a concentrated position around the 1:1 price
 *   3. Add liquidity using the provided SST amount
 *
 * @param config - Pool seed configuration
 * @returns Transaction signature and position mint address
 *
 * @example
 * ```ts
 * const result = await seedOrcaPool({
 *   connection: new Connection(clusterApiUrl("devnet")),
 *   wallet: payerKeypair,
 *   sstMint: new PublicKey("..."),
 *   usdcMint: new PublicKey("..."),
 *   whirlpoolConfig: ORCA_DEVNET_CONFIG,
 *   sstAmountRaw: new BN(1_000_000_000), // 1000 SST @ 6 decimals
 * });
 * console.log("Position:", result.positionMint?.toBase58());
 * ```
 */
export async function seedOrcaPool(config: OrcaPoolConfig): Promise<SeedResult> {
  const {
    connection,
    wallet,
    sstMint,
    usdcMint,
    whirlpoolConfig,
    sstAmountRaw,
    tickSpacing = DEFAULT_TICK_SPACING,
    tickRangeHalfWidth = DEFAULT_TICK_RANGE_HALF_WIDTH,
  } = config;

  // Build Anchor provider + Whirlpool client
  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });
  const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);

  // Fetch or derive the whirlpool PDA
  const whirlpoolPda = PriceMath.getWhirlpoolPda(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    whirlpoolConfig,
    sstMint,
    usdcMint,
    tickSpacing
  );

  let pool;
  try {
    pool = await client.getPool(whirlpoolPda.publicKey);
  } catch {
    // Pool does not exist — initialize it first at 1:1 price
    const initPoolParams: InitPoolParams = {
      whirlpoolsConfig: whirlpoolConfig,
      tokenMintA: sstMint,
      tokenMintB: usdcMint,
      tickSpacing,
      initSqrtPrice: SQRT_PRICE_1_TO_1,
      funder: wallet.publicKey,
      whirlpoolPda,
      tokenVaultAKeypair: Keypair.generate(),
      tokenVaultBKeypair: Keypair.generate(),
      feeTierKey: PriceMath.getFeeTierPda(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        whirlpoolConfig,
        tickSpacing
      ).publicKey,
    };

    const initTx = await WhirlpoolIx.initializePoolIx(ctx.program, initPoolParams);
    const tx = new Transaction().add(...initTx.instructions);
    const sig = await sendAndConfirmTransaction(connection, tx, [
      wallet,
      initPoolParams.tokenVaultAKeypair,
      initPoolParams.tokenVaultBKeypair,
    ]);
    console.log(`[seedOrcaPool] Pool initialized: ${sig}`);

    pool = await client.getPool(whirlpoolPda.publicKey);
  }

  const poolData = pool.getData();

  // Calculate tick bounds around 1:1 price
  const currentTick = TickUtil.getInitializableTickIndex(
    poolData.tickCurrentIndex,
    tickSpacing
  );
  const tickLower = TickUtil.getInitializableTickIndex(
    currentTick - tickRangeHalfWidth,
    tickSpacing
  );
  const tickUpper = TickUtil.getInitializableTickIndex(
    currentTick + tickRangeHalfWidth,
    tickSpacing
  );

  // Calculate liquidity quote
  const quote = increaseLiquidityQuoteByInputTokenWithParams({
    tokenMintA: sstMint,
    tokenMintB: usdcMint,
    sqrtPrice: poolData.sqrtPrice,
    tickCurrentIndex: poolData.tickCurrentIndex,
    tickLowerIndex: tickLower,
    tickUpperIndex: tickUpper,
    inputTokenMint: sstMint,
    inputTokenAmount: sstAmountRaw,
    slippageTolerance: { numerator: new BN(1), denominator: new BN(100) }, // 1% slippage
    tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
  });

  // Open position and add liquidity
  const { positionMint, tx: openTx } = await pool.openPosition(
    tickLower,
    tickUpper,
    quote,
    wallet.publicKey
  );

  const openSig = await openTx.buildAndExecute();

  return {
    txSig: openSig,
    positionMint,
    summary: [
      `[seedOrcaPool] SST/USDC Whirlpool position opened`,
      `  Pool:         ${whirlpoolPda.publicKey.toBase58()}`,
      `  Position:     ${positionMint.toBase58()}`,
      `  Tick range:   [${tickLower}, ${tickUpper}] (spacing=${tickSpacing})`,
      `  SST in:       ${sstAmountRaw.toString()} raw`,
      `  USDC in:      ${quote.tokenMaxB.toString()} raw (max)`,
      `  Tx:           ${openSig}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Raydium CLMM Pool Seeding
// ---------------------------------------------------------------------------

/**
 * Seeds a Raydium CLMM pool for an SSS/USDC pair at a 1:1 peg.
 *
 * The function will:
 *   1. Create or locate the Raydium CLMM pool for (sstMint, usdcMint)
 *   2. Open a position around the 1:1 price
 *   3. Add liquidity using the provided SST amount
 *
 * @param config - Pool seed configuration
 * @returns Transaction signature and summary
 *
 * @example
 * ```ts
 * const result = await seedRaydiumPool({
 *   connection: new Connection(clusterApiUrl("devnet")),
 *   wallet: payerKeypair,
 *   sstMint: new PublicKey("..."),
 *   usdcMint: new PublicKey("..."),
 *   sstAmountRaw: new BN(1_000_000_000),
 * });
 * ```
 */
export async function seedRaydiumPool(config: RaydiumPoolConfig): Promise<SeedResult> {
  const {
    connection,
    wallet,
    sstMint,
    usdcMint,
    sstAmountRaw,
    initialSqrtPriceX64 = SQRT_PRICE_1_TO_1,
  } = config;

  // Initialize Raydium SDK
  const raydium = await Raydium.load({
    owner: wallet,
    connection,
    cluster: "devnet",
    disableFeatureCheck: true,
  });

  // Create the CLMM pool
  const { execute: createExecute, extInfo: createInfo } =
    await raydium.clmm.createPool({
      programId: raydium.clmm.programId,
      mint1: { address: sstMint.toBase58(), decimals: 6 },
      mint2: { address: usdcMint.toBase58(), decimals: 6 },
      ammConfig: { id: raydium.clmm.programId.toBase58() } as ClmmKeys,
      initialPrice: new Decimal(1), // 1:1 peg
      startTime: new BN(0),
      txVersion: "V0",
    } as any);

  const { txIds: createTxIds } = await createExecute({ sendAndConfirm: true });
  const poolId = (createInfo as any)?.poolId?.toBase58?.() ?? "unknown";

  console.log(`[seedRaydiumPool] Pool created: ${poolId} tx=${createTxIds[0]}`);

  // Fetch the pool and open a position
  const poolInfo = await raydium.clmm.getPoolInfoFromRpc(poolId).catch(() => null);
  if (!poolInfo) {
    return {
      txSig: createTxIds[0] ?? "",
      summary: `[seedRaydiumPool] Pool created but could not fetch info for position. Pool: ${poolId}`,
    };
  }

  // Calculate tick range (±100 ticks from current, tight concentrated range)
  const tickSpacing = (poolInfo as any).config?.tickSpacing ?? 1;
  const currentTick = (poolInfo as any).tickCurrent ?? 0;
  const tickLower = Math.round((currentTick - 100) / tickSpacing) * tickSpacing;
  const tickUpper = Math.round((currentTick + 100) / tickSpacing) * tickSpacing;

  const { execute: openExecute } = await raydium.clmm.openPositionFromBase({
    poolInfo: poolInfo as ApiV3PoolInfoConcentratedItem,
    ownerInfo: { useSOLBalance: false },
    tickLower,
    tickUpper,
    base: "MintA",
    baseAmount: sstAmountRaw,
    otherAmountMax: sstAmountRaw, // 1:1, so same nominal
    getEphemeralSigners: async (k) => [],
    txVersion: "V0",
  } as any);

  const { txIds: openTxIds } = await openExecute({ sendAndConfirm: true });

  return {
    txSig: openTxIds[0] ?? createTxIds[0] ?? "",
    summary: [
      `[seedRaydiumPool] SST/USDC CLMM position opened`,
      `  Pool:         ${poolId}`,
      `  Tick range:   [${tickLower}, ${tickUpper}] (spacing=${tickSpacing})`,
      `  SST in:       ${sstAmountRaw.toString()} raw`,
      `  Tx:           ${openTxIds[0]}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Pool Health Monitoring
// ---------------------------------------------------------------------------

/**
 * Checks the health of an Orca Whirlpool or Raydium CLMM pool.
 *
 * Reports:
 *   - Current price and peg deviation in bps
 *   - Price impact for a $1k swap (proxy for depth)
 *   - Available liquidity depth
 *   - Whether the pool is within acceptable peg bounds
 *
 * @param poolAddress - On-chain address of the pool (Whirlpool PDA or Raydium pool)
 * @param connection - RPC connection
 * @param wallet - Wallet (used to build provider)
 * @param poolType - "orca" (default) or "raydium"
 * @returns Pool health report
 *
 * @example
 * ```ts
 * const health = await checkPoolHealth(poolAddress, connection, wallet);
 * if (!health.healthy) {
 *   console.warn(`Peg deviation: ${health.pegDeviationBps} bps`);
 * }
 * ```
 */
export async function checkPoolHealth(
  poolAddress: PublicKey,
  connection: Connection,
  wallet: Keypair,
  poolType: "orca" | "raydium" = "orca"
): Promise<PoolHealth> {
  const now = new Date().toISOString();

  if (poolType === "orca") {
    const anchorWallet = new Wallet(wallet);
    const provider = new AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
    });
    const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
    const client = buildWhirlpoolClient(ctx);

    const pool = await client.getPool(poolAddress);
    const data = pool.getData();

    // Convert sqrt price to human price
    const currentPrice = PriceMath.sqrtPriceX64ToPrice(data.sqrtPrice, 6, 6);
    const pegDeviationBps = Math.round(
      Math.abs(currentPrice.toNumber() - 1.0) * 10_000
    );

    // Estimate depth: liquidity * tick_range_width / sqrt_price as a rough proxy
    const depthQuote = new Decimal(data.liquidity.toString()).mul(0.0001);

    // Rough price impact for 1k USDC: impact_bps ≈ 10_000 * 1000 / depth
    const priceImpactBps1k = depthQuote.gt(0)
      ? Math.min(10_000, Math.round((10_000 * 1_000) / depthQuote.toNumber()))
      : 10_000;

    const healthy = pegDeviationBps <= MAX_PEG_DEVIATION_BPS;

    return {
      poolAddress,
      currentPrice,
      pegDeviationBps,
      priceImpactBps1k,
      depthQuote,
      healthy,
      checkedAt: now,
    };
  } else {
    // Raydium path
    const raydium = await Raydium.load({
      owner: wallet,
      connection,
      cluster: "devnet",
      disableFeatureCheck: true,
    });

    const poolInfo = await raydium.clmm.getPoolInfoFromRpc(poolAddress.toBase58());
    const price = new Decimal((poolInfo as any).price ?? 1);
    const pegDeviationBps = Math.round(Math.abs(price.toNumber() - 1.0) * 10_000);
    const liquidity = new Decimal((poolInfo as any).liquidity?.toString() ?? "0");
    const depthQuote = liquidity.mul(0.0001);
    const priceImpactBps1k = depthQuote.gt(0)
      ? Math.min(10_000, Math.round((10_000 * 1_000) / depthQuote.toNumber()))
      : 10_000;
    const healthy = pegDeviationBps <= MAX_PEG_DEVIATION_BPS;

    return {
      poolAddress,
      currentPrice: price,
      pegDeviationBps,
      priceImpactBps1k,
      depthQuote,
      healthy,
      checkedAt: now,
    };
  }
}

// ---------------------------------------------------------------------------
// Position Rebalancing
// ---------------------------------------------------------------------------

/**
 * Adjusts a concentrated liquidity position's tick range when peg drifts.
 *
 * Strategy:
 *   1. Remove all liquidity from the existing position
 *   2. Close the position
 *   3. Open a new position centered on the current price
 *
 * Only operates on Orca Whirlpool positions (Raydium rebalance is similar
 * but requires the Raydium position NFT).
 *
 * @param poolAddress - Whirlpool pool address
 * @param positionMint - NFT mint of the existing position to rebalance
 * @param newHalfWidth - New tick range half-width (default: DEFAULT_TICK_RANGE_HALF_WIDTH)
 * @param connection - RPC connection
 * @param wallet - Position owner keypair
 * @returns Transaction signature(s) and summary
 *
 * @example
 * ```ts
 * const result = await rebalancePosition(
 *   poolAddress,
 *   positionMint,
 *   20,  // wider range after peg drift
 *   connection,
 *   wallet
 * );
 * ```
 */
export async function rebalancePosition(
  poolAddress: PublicKey,
  positionMint: PublicKey,
  newHalfWidth: number = DEFAULT_TICK_RANGE_HALF_WIDTH,
  connection: Connection,
  wallet: Keypair
): Promise<{ txSigs: string[]; summary: string }> {
  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });
  const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);

  const pool = await client.getPool(poolAddress);
  const poolData = pool.getData();

  // Fetch the existing position
  const positionAddress = (await ctx.program.account.position.all()).find(
    (p: any) => p.account.positionMint.equals(positionMint)
  );

  if (!positionAddress) {
    throw new Error(`Position not found for mint: ${positionMint.toBase58()}`);
  }

  const position = await client.getPosition(positionAddress.publicKey);
  const posData = position.getData();

  // Step 1: Collect fees + remove all liquidity
  const collectTx = await position.collectFees(false);
  const collectSig = await collectTx.buildAndExecute();

  const decreaseTx = await pool.closePosition(
    positionAddress.publicKey,
    { numerator: new BN(1), denominator: new BN(100) } // 1% slippage
  );
  const closeSig = await decreaseTx.buildAndExecute();

  // Step 2: Open new position centered on current price
  const tickSpacing = poolData.tickSpacing;
  const currentTick = TickUtil.getInitializableTickIndex(
    poolData.tickCurrentIndex,
    tickSpacing
  );
  const newTickLower = TickUtil.getInitializableTickIndex(
    currentTick - newHalfWidth,
    tickSpacing
  );
  const newTickUpper = TickUtil.getInitializableTickIndex(
    currentTick + newHalfWidth,
    tickSpacing
  );

  // Use a minimal liquidity amount to re-seed (caller should top up separately)
  const seedAmount = new BN(1_000_000); // 1 SST at 6 decimals
  const quote = increaseLiquidityQuoteByInputTokenWithParams({
    tokenMintA: poolData.tokenMintA,
    tokenMintB: poolData.tokenMintB,
    sqrtPrice: poolData.sqrtPrice,
    tickCurrentIndex: poolData.tickCurrentIndex,
    tickLowerIndex: newTickLower,
    tickUpperIndex: newTickUpper,
    inputTokenMint: poolData.tokenMintA,
    inputTokenAmount: seedAmount,
    slippageTolerance: { numerator: new BN(1), denominator: new BN(100) },
    tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
  });

  const { positionMint: newPositionMint, tx: openTx } = await pool.openPosition(
    newTickLower,
    newTickUpper,
    quote,
    wallet.publicKey
  );

  const openSig = await openTx.buildAndExecute();

  return {
    txSigs: [collectSig, closeSig, openSig],
    summary: [
      `[rebalancePosition] Orca position rebalanced`,
      `  Old position: ${positionMint.toBase58()}`,
      `  New position: ${newPositionMint.toBase58()}`,
      `  New range:    [${newTickLower}, ${newTickUpper}] (±${newHalfWidth} ticks)`,
      `  Collect tx:   ${collectSig}`,
      `  Close tx:     ${closeSig}`,
      `  Open tx:      ${openSig}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// CLI entry point (when run directly)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const [, , command, ...args] = process.argv;

  const usage = `
Usage:
  ts-node scripts/seed-liquidity.ts check-health <poolAddress> [orca|raydium]

Examples:
  ts-node scripts/seed-liquidity.ts check-health 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU orca
`;

  if (!command) {
    console.log(usage);
    process.exit(1);
  }

  if (command === "check-health") {
    const poolAddr = args[0];
    const poolType = (args[1] as "orca" | "raydium") ?? "orca";

    if (!poolAddr) {
      console.error("Error: poolAddress required");
      process.exit(1);
    }

    const connection = new Connection(
      process.env.RPC_URL ?? "https://api.devnet.solana.com",
      "confirmed"
    );
    const wallet = Keypair.generate(); // read-only check, no signing needed

    checkPoolHealth(new PublicKey(poolAddr), connection, wallet, poolType)
      .then((h) => {
        console.log(JSON.stringify(h, (_, v) =>
          v instanceof Decimal ? v.toString() : v,
        2));
        if (!h.healthy) process.exit(2);
      })
      .catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
  } else {
    console.log(usage);
    process.exit(1);
  }
}
