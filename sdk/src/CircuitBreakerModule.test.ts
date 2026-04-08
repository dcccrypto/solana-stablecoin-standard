import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  CircuitBreakerModule,
  FLAG_CIRCUIT_BREAKER_V2,
  type CircuitBreakerParams,
  type CircuitBreakerState,
} from './CircuitBreakerModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const ADMIN      = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT       = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const MINT_B     = new PublicKey('95yogXJdMH6TtZwD4WazNjXB3rFe9MsN4X7V2hLsUG3p');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockProvider(accountData: Buffer | null = null) {
  return {
    wallet: { publicKey: ADMIN },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(
        accountData ? { data: accountData } : null
      ),
    },
  } as any;
}

function makeMockProgram(txSig = 'tx-sig-mock') {
  const rpc = vi.fn().mockResolvedValue(txSig);
  const accounts = vi.fn().mockReturnThis();
  const methodsChain = { accounts, rpc } as any;

  return {
    methods: new Proxy(
      {},
      { get: () => () => methodsChain }
    ),
  } as any;
}

/**
 * Build a minimal StablecoinConfig buffer with specific feature_flags.
 * Canonical offset: [298..306] feature_flags (u64 LE)
 */
function buildConfigData(featureFlags: bigint): Buffer {
  const FEATURE_FLAGS_OFFSET = 298;
  const buf = Buffer.alloc(FEATURE_FLAGS_OFFSET + 8, 0);
  buf.writeBigUInt64LE(featureFlags, FEATURE_FLAGS_OFFSET);
  return buf;
}

// ─── FLAG_CIRCUIT_BREAKER_V2 constant ─────────────────────────────────────────

describe('FLAG_CIRCUIT_BREAKER_V2', () => {
  it('equals 1n (bit 0)', () => {
    expect(FLAG_CIRCUIT_BREAKER_V2).toBe(1n);
  });

  it('equals 1n << 0n', () => {
    expect(FLAG_CIRCUIT_BREAKER_V2).toBe(1n << 0n);
  });

  it('does not overlap with FLAG_SPEND_POLICY (bit 1)', () => {
    expect(FLAG_CIRCUIT_BREAKER_V2 & (1n << 1n)).toBe(0n);
  });

  it('does not overlap with FLAG_DAO_COMMITTEE (bit 2)', () => {
    expect(FLAG_CIRCUIT_BREAKER_V2 & (1n << 2n)).toBe(0n);
  });

  it('does not overlap with FLAG_YIELD_COLLATERAL (bit 3)', () => {
    expect(FLAG_CIRCUIT_BREAKER_V2 & (1n << 3n)).toBe(0n);
  });

  it('does not overlap with FLAG_ZK_COMPLIANCE (bit 4)', () => {
    expect(FLAG_CIRCUIT_BREAKER_V2 & (1n << 4n)).toBe(0n);
  });
});

// ─── getConfigPda ──────────────────────────────────────────────────────────────

describe('CircuitBreakerModule.getConfigPda', () => {
  let cb: CircuitBreakerModule;

  beforeEach(() => {
    cb = new CircuitBreakerModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns a tuple of [PublicKey, number]', () => {
    const [pda, bump] = cb.getConfigPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe('number');
  });

  it('is deterministic — same mint yields same PDA', () => {
    const [pda1] = cb.getConfigPda(MINT);
    const [pda2] = cb.getConfigPda(MINT);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it('produces different PDAs for different mints', () => {
    const [pda1] = cb.getConfigPda(MINT);
    const [pda2] = cb.getConfigPda(MINT_B);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it('uses the provided programId for derivation', () => {
    const OTHER_PROG = new PublicKey('C6wNtHat7AzUSxTkKhqz9CsvJ5sK9PnwKKbwsgjhHRHd');
    const [pda1] = cb.getConfigPda(MINT);
    const cb2 = new CircuitBreakerModule(makeMockProvider(), OTHER_PROG);
    const [pda2] = cb2.getConfigPda(MINT);
    expect(pda1.equals(pda2)).toBe(false);
  });
});

// ─── trigger ──────────────────────────────────────────────────────────────────

describe('CircuitBreakerModule.trigger', () => {
  let cb: CircuitBreakerModule;
  let mockProgram: any;

  beforeEach(() => {
    cb = new CircuitBreakerModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('trigger-sig');
    (cb as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await cb.trigger({ mint: MINT });
    expect(sig).toBe('trigger-sig');
  });

  it('calls rpc with confirmed commitment', async () => {
    await cb.trigger({ mint: MINT });
    expect(mockProgram.methods.setFeatureFlag().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });

  it('calls accounts() with authority, mint, config', async () => {
    await cb.trigger({ mint: MINT });
    const [configPda] = cb.getConfigPda(MINT);
    expect(mockProgram.methods.setFeatureFlag().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      mint: MINT,
      config: configPda,
    });
  });
});

// ─── release ──────────────────────────────────────────────────────────────────

describe('CircuitBreakerModule.release', () => {
  let cb: CircuitBreakerModule;
  let mockProgram: any;

  beforeEach(() => {
    cb = new CircuitBreakerModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('release-sig');
    (cb as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await cb.release({ mint: MINT });
    expect(sig).toBe('release-sig');
  });

  it('calls rpc with confirmed commitment', async () => {
    await cb.release({ mint: MINT });
    expect(mockProgram.methods.clearFeatureFlag().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });

  it('calls accounts() with authority, mint, config', async () => {
    await cb.release({ mint: MINT });
    const [configPda] = cb.getConfigPda(MINT);
    expect(mockProgram.methods.clearFeatureFlag().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      mint: MINT,
      config: configPda,
    });
  });
});

// ─── isTriggered ──────────────────────────────────────────────────────────────

describe('CircuitBreakerModule.isTriggered', () => {
  it('returns false when account does not exist', async () => {
    const cb = new CircuitBreakerModule(makeMockProvider(null), PROGRAM_ID);
    expect(await cb.isTriggered(MINT)).toBe(false);
  });

  it('returns true when FLAG_CIRCUIT_BREAKER_V2 (bit 0) is set', async () => {
    const data = buildConfigData(FLAG_CIRCUIT_BREAKER_V2);
    const cb = new CircuitBreakerModule(makeMockProvider(data), PROGRAM_ID);
    expect(await cb.isTriggered(MINT)).toBe(true);
  });

  it('returns false when FLAG_CIRCUIT_BREAKER_V2 is not set', async () => {
    const data = buildConfigData(1n << 2n); // only DAO committee set
    const cb = new CircuitBreakerModule(makeMockProvider(data), PROGRAM_ID);
    expect(await cb.isTriggered(MINT)).toBe(false);
  });

  it('returns true when multiple flags are set including bit 0', async () => {
    const flags = (1n << 0n) | (1n << 2n) | (1n << 4n);
    const data = buildConfigData(flags);
    const cb = new CircuitBreakerModule(makeMockProvider(data), PROGRAM_ID);
    expect(await cb.isTriggered(MINT)).toBe(true);
  });

  it('returns false when account data is too short', async () => {
    const shortData = Buffer.alloc(10, 0);
    const cb = new CircuitBreakerModule(makeMockProvider(shortData), PROGRAM_ID);
    expect(await cb.isTriggered(MINT)).toBe(false);
  });
});

// ─── getState ─────────────────────────────────────────────────────────────────

describe('CircuitBreakerModule.getState', () => {
  it('returns { triggered: false, flags: 0n } when account does not exist', async () => {
    const cb = new CircuitBreakerModule(makeMockProvider(null), PROGRAM_ID);
    const state = await cb.getState(MINT);
    expect(state.triggered).toBe(false);
    expect(state.flags).toBe(0n);
  });

  it('returns { triggered: true, flags: 1n } when bit 0 is set', async () => {
    const data = buildConfigData(1n);
    const cb = new CircuitBreakerModule(makeMockProvider(data), PROGRAM_ID);
    const state = await cb.getState(MINT);
    expect(state.triggered).toBe(true);
    expect(state.flags).toBe(1n);
  });

  it('returns { triggered: false } when only bit 1 is set', async () => {
    const data = buildConfigData(1n << 1n);
    const cb = new CircuitBreakerModule(makeMockProvider(data), PROGRAM_ID);
    const state = await cb.getState(MINT);
    expect(state.triggered).toBe(false);
    expect(state.flags).toBe(2n);
  });

  it('returns the raw flags bitmask accurately', async () => {
    const flags = 0b10101n; // bits 0, 2, 4
    const data = buildConfigData(flags);
    const cb = new CircuitBreakerModule(makeMockProvider(data), PROGRAM_ID);
    const state = await cb.getState(MINT);
    expect(state.flags).toBe(flags);
    expect(state.triggered).toBe(true);
  });
});
