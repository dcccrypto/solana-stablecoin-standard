/**
 * SSS-107: Security Hardening Client Wrappers — tests
 *
 * Covers SlippageGuard, PythFeedValidator, TimelockHelper, DaoDeduplicationGuard.
 * Min 20 vitest tests required (this file contains 24).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Connection } from '@solana/web3.js';
import {
  SlippageGuard,
  PythFeedValidator,
  TimelockHelper,
  DaoDeduplicationGuard,
  DEFAULT_SLIPPAGE_BUFFER_BPS,
  MIN_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
} from './SecurityHardeningModule';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKey(seed = 'test'): PublicKey {
  // Hash the full seed string into 32 bytes to guarantee uniqueness per seed
  const buf = Buffer.alloc(32, 0);
  for (let i = 0; i < seed.length; i++) {
    buf[i % 32] ^= seed.charCodeAt(i);
    buf[(i + 1) % 32] ^= seed.charCodeAt(i) << 1;
  }
  // Ensure non-zero first byte to avoid zero-pubkey collision
  if (buf[0] === 0) buf[0] = seed.length + 1;
  return new PublicKey(buf);
}

const ZERO_KEY = PublicKey.default;

function makeMockConnection(slotOverride = 1_000_000n): Partial<Connection> {
  return {
    getAccountInfo: vi.fn(),
    getSlot: vi.fn().mockResolvedValue(Number(slotOverride)),
  };
}

function makeMockProgram(configOverrides: Record<string, unknown> = {}): object {
  const defaults = {
    adminOpKind: 0,
    adminOpMatureSlot: 0,
    expectedPythFeed: ZERO_KEY,
    ...configOverrides,
  };
  return {
    programId: makeKey('program'),
    account: {
      stablecoinConfig: {
        fetch: vi.fn().mockResolvedValue(defaults),
      },
    },
  };
}

// ─── SlippageGuard ────────────────────────────────────────────────────────────

describe('SlippageGuard', () => {
  let connection: Partial<Connection>;
  let guard: SlippageGuard;
  const feed = makeKey('feed');

  beforeEach(() => {
    connection = makeMockConnection();
    guard = new SlippageGuard(connection as Connection);
  });

  it('uses injected snapshot and returns correct bps', async () => {
    const result = await guard.computeSlippage(feed, {
      priceSnapshot: { price: 100, confidence: 0.5, validSlot: 1 },
    });
    // confidence/price = 0.005 → 50 bps; + 50 buffer = 100 bps
    expect(result.confidenceBps).toBe(50);
    expect(result.bufferBps).toBe(DEFAULT_SLIPPAGE_BUFFER_BPS);
    expect(result.maxSlippageBps).toBe(100);
    expect(result.feed.equals(feed)).toBe(true);
  });

  it('applies custom buffer', async () => {
    const result = await guard.computeSlippage(feed, {
      priceSnapshot: { price: 100, confidence: 0.5, validSlot: 1 },
      bufferBps: 100,
    });
    expect(result.maxSlippageBps).toBe(150); // 50 + 100
  });

  it('clamps result to MIN_SLIPPAGE_BPS when very tight market', async () => {
    const result = await guard.computeSlippage(feed, {
      priceSnapshot: { price: 100_000, confidence: 0.001, validSlot: 1 },
      bufferBps: 0,
    });
    expect(result.maxSlippageBps).toBeGreaterThanOrEqual(MIN_SLIPPAGE_BPS);
  });

  it('clamps result to MAX_SLIPPAGE_BPS during extreme volatility', async () => {
    const result = await guard.computeSlippage(feed, {
      // 60% confidence / price = extremely volatile
      priceSnapshot: { price: 100, confidence: 60, validSlot: 1 },
    });
    expect(result.maxSlippageBps).toBe(MAX_SLIPPAGE_BPS);
  });

  it('throws when price is zero', async () => {
    await expect(
      guard.computeSlippage(feed, {
        priceSnapshot: { price: 0, confidence: 1, validSlot: 1 },
      }),
    ).rejects.toThrow(/invalid Pyth price/);
  });

  it('throws when price is negative', async () => {
    await expect(
      guard.computeSlippage(feed, {
        priceSnapshot: { price: -1, confidence: 0.5, validSlot: 1 },
      }),
    ).rejects.toThrow(/invalid Pyth price/);
  });

  it('throws when account not found on chain', async () => {
    (connection.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(guard.computeSlippage(feed)).rejects.toThrow(/not found/);
  });
});

// ─── PythFeedValidator ────────────────────────────────────────────────────────

describe('PythFeedValidator', () => {
  const feedA = makeKey('feedA');
  const feedB = makeKey('feedB');
  const mint = makeKey('mint');

  it('validates when feed matches expected (sync)', () => {
    const validator = new PythFeedValidator(makeMockProgram());
    const result = validator.validateSync(feedA, feedA);
    expect(result.valid).toBe(true);
  });

  it('rejects when feed does not match expected (sync)', () => {
    const validator = new PythFeedValidator(makeMockProgram());
    const result = validator.validateSync(feedA, feedB);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/);
    expect(result.reason).toMatch(/FINDING-006/);
  });

  it('passes through with zero expected key (not yet registered)', () => {
    const validator = new PythFeedValidator(makeMockProgram());
    const result = validator.validateSync(feedA, ZERO_KEY);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('async validate: passes when config feed matches', async () => {
    const program = makeMockProgram({ expectedPythFeed: feedA });
    const validator = new PythFeedValidator(program);
    const result = await validator.validate(mint, feedA);
    expect(result.valid).toBe(true);
  });

  it('async validate: rejects on mismatch', async () => {
    const program = makeMockProgram({ expectedPythFeed: feedB });
    const validator = new PythFeedValidator(program);
    const result = await validator.validate(mint, feedA);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/substitution attack/);
  });

  it('async validate: passes for unregistered feed (zero key)', async () => {
    const program = makeMockProgram({ expectedPythFeed: ZERO_KEY });
    const validator = new PythFeedValidator(program);
    const result = await validator.validate(mint, feedA);
    expect(result.valid).toBe(true);
  });
});

// ─── TimelockHelper ───────────────────────────────────────────────────────────

describe('TimelockHelper', () => {
  const mint = makeKey('mint');

  it('returns ready when current slot >= mature slot', async () => {
    const program = makeMockProgram({ adminOpKind: 1, adminOpMatureSlot: 500_000 });
    const connection = makeMockConnection(600_000n);
    const helper = new TimelockHelper(connection as Connection, program);
    const state = await helper.getPendingOp(mint);
    const result = await helper.checkReadyToExecute(state, 600_000n);
    expect(result.ready).toBe(true);
    expect(result.slotsRemaining).toBe(0n);
  });

  it('returns not ready with warning when slot has not reached mature', async () => {
    const program = makeMockProgram({ adminOpKind: 1, adminOpMatureSlot: 1_000_000 });
    const connection = makeMockConnection(500_000n);
    const helper = new TimelockHelper(connection as Connection, program);
    const state = await helper.getPendingOp(mint);
    const result = await helper.checkReadyToExecute(state, 500_000n);
    expect(result.ready).toBe(false);
    expect(result.slotsRemaining).toBe(500_000n);
    expect(result.warning).toMatch(/TimelockHelper/);
    expect(result.warning).toMatch(/FINDING-011/);
  });

  it('secondsRemaining approximation is non-zero when slots remain', async () => {
    const program = makeMockProgram({ adminOpKind: 1, adminOpMatureSlot: 1_000_000 });
    const connection = makeMockConnection();
    const helper = new TimelockHelper(connection as Connection, program);
    const state = await helper.getPendingOp(mint);
    const result = await helper.checkReadyToExecute(state, 500_000n);
    expect(result.secondsRemaining).toBeGreaterThan(0);
  });

  it('returns no-pending warning when opKind is 0', async () => {
    const program = makeMockProgram({ adminOpKind: 0, adminOpMatureSlot: 0 });
    const connection = makeMockConnection();
    const helper = new TimelockHelper(connection as Connection, program);
    const state = await helper.getPendingOp(mint);
    const result = await helper.checkReadyToExecute(state, 999_999n);
    expect(result.ready).toBe(false);
    expect(result.warning).toMatch(/no pending/);
  });

  it('checkMint convenience method delegates correctly', async () => {
    const program = makeMockProgram({ adminOpKind: 2, adminOpMatureSlot: 100 });
    const connection = makeMockConnection(200n);
    const helper = new TimelockHelper(connection as Connection, program);
    const result = await helper.checkMint(mint, 200n);
    expect(result.ready).toBe(true);
  });
});

// ─── DaoDeduplicationGuard ────────────────────────────────────────────────────

describe('DaoDeduplicationGuard', () => {
  const guard = new DaoDeduplicationGuard();
  const keyA = makeKey('A');
  const keyB = makeKey('B');
  const keyC = makeKey('C');

  it('passes for empty list', () => {
    expect(guard.validate([]).valid).toBe(true);
  });

  it('passes for all-unique keys', () => {
    const result = guard.validate([keyA, keyB, keyC]);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toHaveLength(0);
  });

  it('rejects single duplicate pair', () => {
    const result = guard.validate([keyA, keyB, keyA]);
    expect(result.valid).toBe(false);
    expect(result.duplicates).toHaveLength(1);
    expect(result.reason).toMatch(/FINDING-012/);
  });

  it('reports multiple distinct duplicates', () => {
    const result = guard.validate([keyA, keyB, keyA, keyC, keyB]);
    expect(result.valid).toBe(false);
    expect(result.duplicates).toHaveLength(2);
  });

  it('does not report triplicate key more than once in duplicates list', () => {
    // [A, A, A] — A is duplicate; should appear exactly once in duplicates
    const result = guard.validate([keyA, keyA, keyA]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toBe(keyA.toBase58());
  });

  it('assertNoDuplicates does not throw for unique list', () => {
    expect(() => guard.assertNoDuplicates([keyA, keyB, keyC])).not.toThrow();
  });

  it('assertNoDuplicates throws on duplicate', () => {
    expect(() => guard.assertNoDuplicates([keyA, keyA])).toThrow(/duplicate/i);
  });
});
