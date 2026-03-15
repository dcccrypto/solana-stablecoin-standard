import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  YieldCollateralModule,
  FLAG_YIELD_COLLATERAL,
  type YieldCollateralState,
} from './YieldCollateralModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID   = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
const ADMIN        = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT         = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const ST_SOL_MINT  = new PublicKey('7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj');
const M_SOL_MINT   = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const JITO_SOL     = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const B_SOL        = new PublicKey('bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockProvider() {
  return {
    wallet: { publicKey: ADMIN },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    },
  } as any;
}

function makeMockProgram(opts: {
  rpcResult?: string;
  fetchYcResult?: any;
  fetchConfigResult?: any;
} = {}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? 'tx-sig-mock');
  const accounts = vi.fn().mockReturnThis();
  const methodsChain = { accounts, rpc } as any;

  return {
    methods: new Proxy(
      {},
      { get: () => () => methodsChain }
    ),
    account: {
      yieldCollateralConfig: {
        fetch: vi.fn().mockResolvedValue(
          opts.fetchYcResult ?? {
            sssMint: MINT,
            whitelistedMints: [ST_SOL_MINT, M_SOL_MINT],
            bump: 255,
          }
        ),
      },
      stablecoinConfig: {
        fetch: vi.fn().mockResolvedValue(
          opts.fetchConfigResult ?? {
            featureFlags: { toString: () => '8' }, // 0x08 = FLAG_YIELD_COLLATERAL
          }
        ),
      },
    },
  } as any;
}

/** Inject a mock program into a module's private cache. */
function injectProgram(mod: YieldCollateralModule, program: any) {
  (mod as any)._program = program;
}

// ─── FLAG_YIELD_COLLATERAL ────────────────────────────────────────────────────

describe('FLAG_YIELD_COLLATERAL', () => {
  it('equals 1n << 3n (0x08)', () => {
    expect(FLAG_YIELD_COLLATERAL).toBe(8n);
  });

  it('does not overlap with bit 0 (circuit breaker)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 0n)).toBe(0n);
  });

  it('does not overlap with bit 1 (spend policy)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 1n)).toBe(0n);
  });

  it('does not overlap with bit 2 (dao committee)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 2n)).toBe(0n);
  });

  it('is unique among defined flag bits', () => {
    const others = [1n << 0n, 1n << 1n, 1n << 2n];
    for (const other of others) {
      expect(FLAG_YIELD_COLLATERAL & other).toBe(0n);
    }
  });
});

// ─── PDA helpers ──────────────────────────────────────────────────────────────

describe('YieldCollateralModule — PDA helpers', () => {
  let mod: YieldCollateralModule;

  beforeEach(() => {
    mod = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
  });

  it('getConfigPda returns a valid PublicKey', () => {
    const [pda, bump] = mod.getConfigPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getConfigPda is deterministic', () => {
    const [a] = mod.getConfigPda(MINT);
    const [b] = mod.getConfigPda(MINT);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it('getYieldCollateralPda returns a valid PublicKey', () => {
    const [pda, bump] = mod.getYieldCollateralPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getYieldCollateralPda is deterministic', () => {
    const [a] = mod.getYieldCollateralPda(MINT);
    const [b] = mod.getYieldCollateralPda(MINT);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it('getConfigPda and getYieldCollateralPda are distinct', () => {
    const [config] = mod.getConfigPda(MINT);
    const [yc] = mod.getYieldCollateralPda(MINT);
    expect(config.toBase58()).not.toBe(yc.toBase58());
  });

  it('PDAs differ for different mints', () => {
    const otherMint = ST_SOL_MINT;
    const [a] = mod.getYieldCollateralPda(MINT);
    const [b] = mod.getYieldCollateralPda(otherMint);
    expect(a.toBase58()).not.toBe(b.toBase58());
  });
});

// ─── enableYieldCollateral ───────────────────────────────────────────────────

describe('YieldCollateralModule.enableYieldCollateral', () => {
  let mod: YieldCollateralModule;
  let program: any;

  beforeEach(() => {
    mod = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    program = makeMockProgram();
    injectProgram(mod, program);
  });

  it('returns a transaction signature', async () => {
    const sig = await mod.enableYieldCollateral({ mint: MINT });
    expect(sig).toBe('tx-sig-mock');
  });

  it('calls initYieldCollateral on the program', async () => {
    // The Proxy intercepts all property access; verify via the shared rpc mock.
    const rpcFn = program.methods.initYieldCollateral().accounts().rpc;
    // Reset call count then exercise the module method
    rpcFn.mockClear();
    await mod.enableYieldCollateral({ mint: MINT });
    expect(rpcFn).toHaveBeenCalledTimes(1);
  });

  it('passes empty initialMints by default', async () => {
    // Should not throw with no initialMints
    await expect(mod.enableYieldCollateral({ mint: MINT })).resolves.toBe('tx-sig-mock');
  });

  it('passes provided initialMints', async () => {
    await expect(
      mod.enableYieldCollateral({ mint: MINT, initialMints: [ST_SOL_MINT, M_SOL_MINT] })
    ).resolves.toBe('tx-sig-mock');
  });
});

// ─── disableYieldCollateral ──────────────────────────────────────────────────

describe('YieldCollateralModule.disableYieldCollateral', () => {
  let mod: YieldCollateralModule;
  let program: any;

  beforeEach(() => {
    mod = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    program = makeMockProgram();
    injectProgram(mod, program);
  });

  it('returns a transaction signature', async () => {
    const sig = await mod.disableYieldCollateral({ mint: MINT });
    expect(sig).toBe('tx-sig-mock');
  });

  it('calls clearFeatureFlag on the program', async () => {
    const rpcFn = program.methods.clearFeatureFlag().accounts().rpc;
    await mod.disableYieldCollateral({ mint: MINT });
    expect(rpcFn).toHaveBeenCalledTimes(1);
  });
});

// ─── addWhitelistedMint ───────────────────────────────────────────────────────

describe('YieldCollateralModule.addWhitelistedMint', () => {
  let mod: YieldCollateralModule;
  let program: any;

  beforeEach(() => {
    mod = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    program = makeMockProgram();
    injectProgram(mod, program);
  });

  it('returns a transaction signature', async () => {
    const sig = await mod.addWhitelistedMint({ mint: MINT, collateralMint: JITO_SOL });
    expect(sig).toBe('tx-sig-mock');
  });

  it('calls addYieldCollateralMint on the program', async () => {
    const rpcFn = program.methods.addYieldCollateralMint().accounts().rpc;
    await mod.addWhitelistedMint({ mint: MINT, collateralMint: B_SOL });
    expect(rpcFn).toHaveBeenCalledTimes(1);
  });
});

// ─── fetchYieldCollateralState ────────────────────────────────────────────────

describe('YieldCollateralModule.fetchYieldCollateralState', () => {
  let mod: YieldCollateralModule;

  beforeEach(() => {
    mod = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns decoded state when account exists', async () => {
    const program = makeMockProgram({
      fetchYcResult: {
        sssMint: MINT,
        whitelistedMints: [ST_SOL_MINT, M_SOL_MINT],
        bump: 253,
      },
    });
    injectProgram(mod, program);

    const state = await mod.fetchYieldCollateralState(MINT);
    expect(state).not.toBeNull();
    expect(state!.sssMint.toBase58()).toBe(MINT.toBase58());
    expect(state!.whitelistedMints).toHaveLength(2);
    expect(state!.whitelistedMints[0].toBase58()).toBe(ST_SOL_MINT.toBase58());
    expect(state!.bump).toBe(253);
  });

  it('returns null when account does not exist', async () => {
    const program = makeMockProgram();
    program.account.yieldCollateralConfig.fetch = vi.fn().mockRejectedValue(new Error('Account not found'));
    injectProgram(mod, program);

    const state = await mod.fetchYieldCollateralState(MINT);
    expect(state).toBeNull();
  });

  it('returns empty whitelist when no mints added', async () => {
    const program = makeMockProgram({
      fetchYcResult: { sssMint: MINT, whitelistedMints: [], bump: 254 },
    });
    injectProgram(mod, program);

    const state = await mod.fetchYieldCollateralState(MINT);
    expect(state!.whitelistedMints).toHaveLength(0);
  });

  it('can hold up to 8 whitelisted mints', async () => {
    // Generate valid pubkeys by incrementing known fixture keys
    const baseMints = [ST_SOL_MINT, M_SOL_MINT, JITO_SOL, B_SOL, MINT, ADMIN,
      new PublicKey('4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM'),
      new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    ];
    const program = makeMockProgram({
      fetchYcResult: { sssMint: MINT, whitelistedMints: baseMints, bump: 200 },
    });
    injectProgram(mod, program);

    const state = await mod.fetchYieldCollateralState(MINT);
    expect(state!.whitelistedMints).toHaveLength(8);
  });
});

// ─── isYieldCollateralEnabled ─────────────────────────────────────────────────

describe('YieldCollateralModule.isYieldCollateralEnabled', () => {
  let mod: YieldCollateralModule;

  beforeEach(() => {
    mod = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns true when FLAG_YIELD_COLLATERAL is set', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '8' } }, // 0x08
    });
    injectProgram(mod, program);

    expect(await mod.isYieldCollateralEnabled(MINT)).toBe(true);
  });

  it('returns true when multiple flags including YIELD_COLLATERAL are set', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '15' } }, // 0x0f = all 4 flags
    });
    injectProgram(mod, program);

    expect(await mod.isYieldCollateralEnabled(MINT)).toBe(true);
  });

  it('returns false when FLAG_YIELD_COLLATERAL is not set', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '7' } }, // 0x07 = bits 0-2
    });
    injectProgram(mod, program);

    expect(await mod.isYieldCollateralEnabled(MINT)).toBe(false);
  });

  it('returns false when feature_flags is zero', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '0' } },
    });
    injectProgram(mod, program);

    expect(await mod.isYieldCollateralEnabled(MINT)).toBe(false);
  });

  it('returns false when config account does not exist', async () => {
    const program = makeMockProgram();
    program.account.stablecoinConfig.fetch = vi.fn().mockRejectedValue(new Error('Not found'));
    injectProgram(mod, program);

    expect(await mod.isYieldCollateralEnabled(MINT)).toBe(false);
  });
});
