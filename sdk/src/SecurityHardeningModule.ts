/**
 * SSS-107: Security Hardening Client Wrappers
 *
 * Provides four safety guards based on SSS-085 P0 audit findings:
 *
 * 1. **SlippageGuard** — auto-compute `max_slippage_bps` from live Pyth market
 *    data before liquidation calls (prevents MEV sandwich / value loss).
 * 2. **PythFeedValidator** — validate feed pubkey against registered
 *    `expected_pyth_feed` before CDP deposit/withdrawal (blocks FINDING-006).
 * 3. **TimelockHelper** — track pending admin operations client-side; warn
 *    when timelock has not yet elapsed before execute (FINDING-011).
 * 4. **DaoDeduplicationGuard** — reject duplicate pubkeys before
 *    propose/vote calls (blocks quorum-bypass via repeated keys, FINDING-012).
 */

import { Connection, PublicKey } from '@solana/web3.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default slippage buffer applied on top of volatility estimate (bps).
 * E.g. if estimated 1-block vol is 80 bps, guard returns 80 + 50 = 130 bps.
 */
export const DEFAULT_SLIPPAGE_BUFFER_BPS = 50;

/**
 * Minimum acceptable `max_slippage_bps` floor (0.1 % = 10 bps).
 */
export const MIN_SLIPPAGE_BPS = 10;

/**
 * Maximum acceptable `max_slippage_bps` cap (10 % = 1 000 bps).
 * Values above this are almost certainly a configuration error.
 */
export const MAX_SLIPPAGE_BPS = 1_000;

/**
 * Solana slot time approximation in milliseconds (~400 ms).
 */
export const SLOT_MS = 400;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Raw Pyth price account data as returned by `parsePriceData`
 * (subset used by {@link SlippageGuard}).
 */
export interface PythPriceSnapshot {
  /** Current aggregate price (USD). */
  price: number;
  /**
   * 1-σ confidence interval around `price` (USD).
   * Used as a proxy for single-block price volatility.
   */
  confidence: number;
  /** Unix timestamp of this price update (seconds). */
  validSlot: number;
}

/**
 * Result returned by {@link SlippageGuard.computeSlippage}.
 */
export interface SlippageResult {
  /**
   * Recommended `max_slippage_bps` to pass to the on-chain instruction.
   * Clamped to [{@link MIN_SLIPPAGE_BPS}, {@link MAX_SLIPPAGE_BPS}].
   */
  maxSlippageBps: number;
  /**
   * Raw confidence-to-price ratio in basis points (before buffer).
   */
  confidenceBps: number;
  /**
   * The applied buffer in basis points ({@link DEFAULT_SLIPPAGE_BUFFER_BPS}
   * unless overridden).
   */
  bufferBps: number;
  /** The Pyth feed pubkey that was queried. */
  feed: PublicKey;
}

/**
 * Options for {@link SlippageGuard.computeSlippage}.
 */
export interface SlippageGuardOptions {
  /**
   * Extra basis points added to the confidence-derived estimate.
   * @default {@link DEFAULT_SLIPPAGE_BUFFER_BPS}
   */
  bufferBps?: number;
  /**
   * Override injected price snapshot (for testing without a live RPC call).
   * If provided, `connection` is not used.
   */
  priceSnapshot?: PythPriceSnapshot;
}

/**
 * Result of {@link PythFeedValidator.validate}.
 */
export interface FeedValidationResult {
  /** `true` when the feed is acceptable; `false` means the call should be aborted. */
  valid: boolean;
  /** The feed pubkey that was checked. */
  feed: PublicKey;
  /** The expected feed pubkey stored in `StablecoinConfig`. */
  expected: PublicKey;
  /** Human-readable reason for rejection (only set when `valid = false`). */
  reason?: string;
}

/**
 * Decoded Pyth feed info from on-chain `StablecoinConfig`.
 * (Only the fields needed by the validator.)
 */
export interface StablecoinConfigFeedInfo {
  /** The `expected_pyth_feed` field set by `set_pyth_feed`. Default: zero key. */
  expectedPythFeed: PublicKey;
}

/**
 * Describes a pending admin timelock operation (mirrors {@link PendingTimelockOp}).
 */
export interface TimelockState {
  /** The stablecoin mint whose config holds this op. */
  mint: PublicKey;
  /** Operation kind discriminant (0 = none). */
  opKind: number;
  /** Slot at which this op matures. 0n when no op is pending. */
  matureSlot: bigint;
  /** Whether there is an active pending operation. */
  isPending: boolean;
}

/**
 * Result of {@link TimelockHelper.checkReadyToExecute}.
 */
export interface TimelockReadinessResult {
  /** `true` when the operation is mature and safe to execute. */
  ready: boolean;
  /** Current slot (fetched from RPC when not overridden). */
  currentSlot: bigint;
  /** Slots remaining until maturity (0 when ready). */
  slotsRemaining: bigint;
  /**
   * Estimated wall-clock seconds remaining (approximate, assuming
   * {@link SLOT_MS} per slot).
   */
  secondsRemaining: number;
  /** Warning message when `ready = false`. */
  warning?: string;
}

/**
 * Result of {@link DaoDeduplicationGuard.validate}.
 */
export interface DeduplicationResult {
  /** `true` when no duplicates were found. */
  valid: boolean;
  /** All input pubkeys (stringified) that appeared more than once. */
  duplicates: string[];
  /** Human-readable warning (only set when `valid = false`). */
  reason?: string;
}

// ─── SlippageGuard ────────────────────────────────────────────────────────────

/**
 * Auto-compute `max_slippage_bps` from live Pyth price data before
 * liquidation calls.
 *
 * **Rationale (SSS-085 / FINDING-006 follow-up)**
 * Liquidation instructions that pass a hard-coded slippage value are
 * susceptible to MEV sandwich attacks when market volatility spikes.
 * This guard derives a data-driven slippage bound from the current
 * Pyth confidence interval (confidence / price * 10 000 bps) and adds
 * a configurable buffer.
 *
 * @example
 * ```ts
 * const guard = new SlippageGuard(connection);
 * const { maxSlippageBps } = await guard.computeSlippage(pythFeedPubkey);
 * await cdp.liquidate({ ..., maxSlippageBps });
 * ```
 */
export class SlippageGuard {
  constructor(private readonly connection: Connection) {}

  /**
   * Fetch current Pyth price data and derive a safe `max_slippage_bps`.
   *
   * @param feed — Pyth price feed account pubkey.
   * @param opts — Optional overrides (buffer, injected snapshot).
   * @returns {@link SlippageResult}
   * @throws When the feed account cannot be fetched or price is unavailable.
   */
  async computeSlippage(
    feed: PublicKey,
    opts: SlippageGuardOptions = {},
  ): Promise<SlippageResult> {
    const bufferBps = opts.bufferBps ?? DEFAULT_SLIPPAGE_BUFFER_BPS;

    let snapshot: PythPriceSnapshot;
    if (opts.priceSnapshot) {
      snapshot = opts.priceSnapshot;
    } else {
      snapshot = await this._fetchPythSnapshot(feed);
    }

    if (snapshot.price <= 0) {
      throw new Error(`SlippageGuard: invalid Pyth price (${snapshot.price}) for feed ${feed.toBase58()}`);
    }

    const confidenceBps = Math.round((snapshot.confidence / snapshot.price) * 10_000);
    const rawBps = confidenceBps + bufferBps;
    const maxSlippageBps = Math.max(MIN_SLIPPAGE_BPS, Math.min(MAX_SLIPPAGE_BPS, rawBps));

    return { maxSlippageBps, confidenceBps, bufferBps, feed };
  }

  /**
   * Fetch a Pyth price snapshot from chain.
   * In production this decodes the raw Pyth v2 price account layout.
   * The implementation reads from the raw account and extracts
   * `price` and `conf` from the aggregate price struct.
   *
   * @internal
   */
  async _fetchPythSnapshot(feed: PublicKey): Promise<PythPriceSnapshot> {
    const accountInfo = await this.connection.getAccountInfo(feed);
    if (!accountInfo) {
      throw new Error(`SlippageGuard: Pyth feed account not found: ${feed.toBase58()}`);
    }

    // Pyth v2 price account layout (big-endian layout described in pyth-client):
    //   offset 0  : magic (4 bytes)  = 0xa1b2c3d4
    //   offset 4  : ver   (4 bytes)
    //   offset 8  : atype (4 bytes)  = 3 (price)
    //   ...
    //   Aggregate price data starts at offset 208 in a Price account:
    //   offset 208: price (i64)
    //   offset 216: conf  (u64)
    //   offset 224: status (u32)
    //   offset 232: pub_slot (u64)
    //
    // For SDK safety this guard uses a minimal decode of just the
    // aggregate price + confidence fields.
    const AGGREGATE_PRICE_OFFSET = 208;
    const data = accountInfo.data;

    if (data.length < AGGREGATE_PRICE_OFFSET + 32) {
      throw new Error(`SlippageGuard: Pyth feed account data too short (${data.length} bytes)`);
    }

    // Read as little-endian signed i64 (price) and unsigned u64 (conf)
    const priceLow = data.readUInt32LE(AGGREGATE_PRICE_OFFSET);
    const priceHigh = data.readInt32LE(AGGREGATE_PRICE_OFFSET + 4);
    const priceRaw = priceHigh * 4294967296 + priceLow; // i64 → number (safe for typical price magnitudes)

    const confLow = data.readUInt32LE(AGGREGATE_PRICE_OFFSET + 8);
    const confHigh = data.readUInt32LE(AGGREGATE_PRICE_OFFSET + 12);
    const confRaw = confHigh * 4294967296 + confLow;

    const pubSlotLow = data.readUInt32LE(AGGREGATE_PRICE_OFFSET + 24);
    const pubSlotHigh = data.readUInt32LE(AGGREGATE_PRICE_OFFSET + 28);
    const validSlot = pubSlotHigh * 4294967296 + pubSlotLow;

    // Pyth price exponent is at offset 20 in the price account
    const exponent = data.readInt32LE(20);
    const scale = Math.pow(10, exponent);

    return {
      price: priceRaw * scale,
      confidence: confRaw * scale,
      validSlot,
    };
  }
}

// ─── PythFeedValidator ────────────────────────────────────────────────────────

/**
 * Validate a Pyth feed pubkey against the registered `expected_pyth_feed`
 * on `StablecoinConfig` before CDP deposit or withdrawal.
 *
 * **Rationale (SSS-085 Fix 1 / FINDING-006)**
 * The on-chain program now rejects any price-feed account that doesn't
 * match `config.expected_pyth_feed`. This SDK guard mirrors that check
 * client-side so callers get a clear error before even sending the
 * transaction, preventing wasted fees and opaque on-chain errors.
 *
 * @example
 * ```ts
 * const validator = new PythFeedValidator(program);
 * const result = await validator.validate(mint, userSuppliedFeed);
 * if (!result.valid) throw new Error(result.reason);
 * ```
 */
export class PythFeedValidator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly program: any) {}

  /**
   * Validate `feed` against `StablecoinConfig.expected_pyth_feed` for `mint`.
   *
   * If `expected_pyth_feed` is the zero pubkey (feed not yet registered),
   * validation passes with a warning so existing integrations are not broken.
   *
   * @param mint — The stablecoin mint pubkey.
   * @param feed — The feed pubkey the caller intends to pass to the instruction.
   * @returns {@link FeedValidationResult}
   */
  async validate(mint: PublicKey, feed: PublicKey): Promise<FeedValidationResult> {
    const config = await this._fetchConfig(mint);
    return this.validateSync(feed, config.expectedPythFeed);
  }

  /**
   * Synchronous variant that accepts a pre-fetched `expectedPythFeed`.
   * Prefer this when you've already loaded the config account.
   */
  validateSync(feed: PublicKey, expected: PublicKey): FeedValidationResult {
    const zeroKey = PublicKey.default;

    if (expected.equals(zeroKey)) {
      // Feed not yet registered — pass through with a warning but don't block.
      return {
        valid: true,
        feed,
        expected,
      };
    }

    if (!feed.equals(expected)) {
      return {
        valid: false,
        feed,
        expected,
        reason:
          `PythFeedValidator: feed mismatch. ` +
          `Expected ${expected.toBase58()}, got ${feed.toBase58()}. ` +
          `This may indicate a price-feed substitution attack (SSS-085 FINDING-006).`,
      };
    }

    return { valid: true, feed, expected };
  }

  /**
   * Fetch `StablecoinConfig` and extract feed info.
   * @internal
   */
  async _fetchConfig(mint: PublicKey): Promise<StablecoinConfigFeedInfo> {
    // Derive config PDA using the same seed as the Anchor program.
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('stablecoin-config'), mint.toBuffer()],
      this.program.programId,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = await this.program.account.stablecoinConfig.fetch(configPda);
    return {
      expectedPythFeed: config.expectedPythFeed as PublicKey,
    };
  }
}

// ─── TimelockHelper ───────────────────────────────────────────────────────────

/**
 * Track pending admin timelock operations client-side and warn when
 * the delay has not yet elapsed before calling `executeTimelockOp`.
 *
 * **Rationale (SSS-085 Fix 2 / FINDING-011)**
 * The on-chain `execute_timelocked_op` instruction checks `clock.slot >=
 * admin_op_mature_slot` and reverts with `TimelockNotMature` if the delay
 * hasn't passed. Providing this helper SDK-side lets callers surface a
 * friendly warning (including time remaining) before even attempting the
 * transaction, improving UX and preventing wasted fees.
 *
 * @example
 * ```ts
 * const helper = new TimelockHelper(connection, program);
 * const state = await helper.getPendingOp(mint);
 * const { ready, warning } = await helper.checkReadyToExecute(state);
 * if (!ready) console.warn(warning);
 * ```
 */
export class TimelockHelper {
  constructor(
    private readonly connection: Connection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly program: any,
  ) {}

  /**
   * Fetch the pending timelock operation for `mint` from chain.
   * Returns a {@link TimelockState} with `isPending = false` when no op exists.
   */
  async getPendingOp(mint: PublicKey): Promise<TimelockState> {
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('stablecoin-config'), mint.toBuffer()],
      this.program.programId,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = await this.program.account.stablecoinConfig.fetch(configPda);
    const opKind: number = config.adminOpKind ?? 0;
    const matureSlot = BigInt(config.adminOpMatureSlot?.toString() ?? '0');
    return {
      mint,
      opKind,
      matureSlot,
      isPending: opKind !== 0,
    };
  }

  /**
   * Check whether a pending timelock operation is mature (safe to execute).
   *
   * @param state — Timelock state from {@link getPendingOp}.
   * @param currentSlotOverride — Inject a current slot (for testing).
   * @returns {@link TimelockReadinessResult}
   */
  async checkReadyToExecute(
    state: TimelockState,
    currentSlotOverride?: bigint,
  ): Promise<TimelockReadinessResult> {
    if (!state.isPending) {
      return {
        ready: false,
        currentSlot: currentSlotOverride ?? 0n,
        slotsRemaining: 0n,
        secondsRemaining: 0,
        warning: 'TimelockHelper: no pending operation for this mint.',
      };
    }

    const currentSlot =
      currentSlotOverride ?? BigInt(await this.connection.getSlot('finalized'));

    if (currentSlot >= state.matureSlot) {
      return {
        ready: true,
        currentSlot,
        slotsRemaining: 0n,
        secondsRemaining: 0,
      };
    }

    const slotsRemaining = state.matureSlot - currentSlot;
    const secondsRemaining = Number(slotsRemaining) * (SLOT_MS / 1_000);

    return {
      ready: false,
      currentSlot,
      slotsRemaining,
      secondsRemaining,
      warning:
        `TimelockHelper: operation not yet mature. ` +
        `${slotsRemaining} slots remaining ` +
        `(≈ ${Math.ceil(secondsRemaining / 3600)} h). ` +
        `Mature at slot ${state.matureSlot}. ` +
        `(SSS-085 FINDING-011 — do not call executeTimelockOp early.)`,
    };
  }

  /**
   * Convenience: fetch pending op and check readiness in one call.
   */
  async checkMint(
    mint: PublicKey,
    currentSlotOverride?: bigint,
  ): Promise<TimelockReadinessResult> {
    const state = await this.getPendingOp(mint);
    return this.checkReadyToExecute(state, currentSlotOverride);
  }
}

// ─── DaoDeduplicationGuard ────────────────────────────────────────────────────

/**
 * Reject duplicate pubkeys before DAO `propose` / `vote` calls.
 *
 * **Rationale (SSS-085 Fix 3 / FINDING-012)**
 * The on-chain `init_dao_committee` instruction performs an O(n²) pairwise
 * deduplication check and reverts with `DuplicateMember` on duplicates.
 * This guard mirrors the same check client-side, providing a clear error
 * message (including which keys are duplicated) before sending the tx.
 *
 * Also useful for validating `vote` participant lists and any other
 * multi-pubkey operations where duplicates could affect quorum semantics.
 *
 * @example
 * ```ts
 * const guard = new DaoDeduplicationGuard();
 * const result = guard.validate(members);
 * if (!result.valid) throw new Error(result.reason);
 * ```
 */
export class DaoDeduplicationGuard {
  /**
   * Check `keys` for any repeated pubkeys.
   *
   * Uses base-58 string equality (same semantic as the on-chain check).
   *
   * @param keys — List of pubkeys to check (e.g. committee members, voters).
   * @returns {@link DeduplicationResult}
   */
  validate(keys: PublicKey[]): DeduplicationResult {
    const seen = new Map<string, number>();
    const duplicates: string[] = [];

    for (const key of keys) {
      const str = key.toBase58();
      const count = (seen.get(str) ?? 0) + 1;
      seen.set(str, count);
      if (count === 2) {
        // Only add to duplicates once per unique duplicate key
        duplicates.push(str);
      }
    }

    if (duplicates.length > 0) {
      return {
        valid: false,
        duplicates,
        reason:
          `DaoDeduplicationGuard: ${duplicates.length} duplicate pubkey(s) detected: ` +
          duplicates.map((k) => k.slice(0, 8) + '…').join(', ') +
          `. Duplicate members could allow quorum bypass (SSS-085 FINDING-012). ` +
          `Remove duplicates before calling initDaoCommittee.`,
      };
    }

    return { valid: true, duplicates: [] };
  }

  /**
   * Convenience: throw if duplicates are found.
   * @throws {Error} with a descriptive message on any duplicate.
   */
  assertNoDuplicates(keys: PublicKey[]): void {
    const result = this.validate(keys);
    if (!result.valid) {
      throw new Error(result.reason);
    }
  }
}
