import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import {
  YieldCollateralModule,
  FLAG_YIELD_COLLATERAL,
  type YieldCollateralConfig,
  type InitYieldCollateralParams,
  type AddYieldCollateralMintParams,
} from './YieldCollateralModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKey(label: string): PublicKey {
  // Deterministic 32-byte key from a short label (padded with zeros)
  const buf = Buffer.alloc(32);
  Buffer.from(label).copy(buf);
  return new PublicKey(buf);
}

function mockProvider(walletKey?: PublicKey): AnchorProvider {
  return {
    wallet: { publicKey: walletKey ?? makeKey('authority') },
    connection: {},
  } as unknown as AnchorProvider;
}

const PROGRAM_ID = makeKey('program_id');

// ─── FLAG_YIELD_COLLATERAL ────────────────────────────────────────────────────

describe('FLAG_YIELD_COLLATERAL', () => {
  it('equals 1n << 3n (0x08)', () => {
    expect(FLAG_YIELD_COLLATERAL).toBe(8n);
  });

  it('is bit 3 and does not overlap FLAG_DAO_COMMITTEE (bit 2)', () => {
    const FLAG_DAO_COMMITTEE = 1n << 2n;
    expect(FLAG_YIELD_COLLATERAL & FLAG_DAO_COMMITTEE).toBe(0n);
  });

  it('is bit 3 and does not overlap FLAG_SPEND_POLICY (bit 1)', () => {
    const FLAG_SPEND_POLICY = 1n << 1n;
    expect(FLAG_YIELD_COLLATERAL & FLAG_SPEND_POLICY).toBe(0n);
  });

  it('is bit 3 and does not overlap FLAG_CIRCUIT_BREAKER (bit 0)', () => {
    const FLAG_CIRCUIT_BREAKER = 1n << 0n;
    expect(FLAG_YIELD_COLLATERAL & FLAG_CIRCUIT_BREAKER).toBe(0n);
  });

  it('can be combined with other flags', () => {
    const combined = FLAG_YIELD_COLLATERAL | (1n << 2n) | (1n << 1n) | (1n << 0n);
    expect(combined).toBe(0x0fn);
    expect((combined & FLAG_YIELD_COLLATERAL) !== 0n).toBe(true);
  });

  it('can be cleared from a combined flags value', () => {
    const flags = FLAG_YIELD_COLLATERAL | (1n << 2n);
    const cleared = flags & ~FLAG_YIELD_COLLATERAL;
    expect(cleared).toBe(1n << 2n);
    expect((cleared & FLAG_YIELD_COLLATERAL) !== 0n).toBe(false);
  });
});

// ─── PDA Derivation ───────────────────────────────────────────────────────────

describe('YieldCollateralModule — PDA derivation', () => {
  let mod: YieldCollateralModule;
  const mint = makeKey('mint_abc');

  beforeEach(() => {
    mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
  });

  it('getConfigPda returns a valid PublicKey tuple', () => {
    const [pda, bump] = mod.getConfigPda(mint);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getYieldCollateralConfigPda returns a valid PublicKey tuple', () => {
    const [pda, bump] = mod.getYieldCollateralConfigPda(mint);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getConfigPda is deterministic for the same mint', () => {
    const [pda1] = mod.getConfigPda(mint);
    const [pda2] = mod.getConfigPda(mint);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it('getYieldCollateralConfigPda is deterministic for the same mint', () => {
    const [pda1] = mod.getYieldCollateralConfigPda(mint);
    const [pda2] = mod.getYieldCollateralConfigPda(mint);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it('getConfigPda differs from getYieldCollateralConfigPda for the same mint', () => {
    const [configPda] = mod.getConfigPda(mint);
    const [ycPda] = mod.getYieldCollateralConfigPda(mint);
    expect(configPda.equals(ycPda)).toBe(false);
  });

  it('PDAs differ for different mints', () => {
    const mint2 = makeKey('mint_xyz');
    const [pda1] = mod.getYieldCollateralConfigPda(mint);
    const [pda2] = mod.getYieldCollateralConfigPda(mint2);
    expect(pda1.equals(pda2)).toBe(false);
  });
});

// ─── Constructor ─────────────────────────────────────────────────────────────

describe('YieldCollateralModule — constructor', () => {
  it('can be instantiated with a provider and programId', () => {
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    expect(mod).toBeDefined();
  });

  it('exposes CONFIG_SEED as static', () => {
    expect(YieldCollateralModule.CONFIG_SEED).toEqual(Buffer.from('stablecoin-config'));
  });

  it('exposes YIELD_COLLATERAL_SEED as static', () => {
    expect(YieldCollateralModule.YIELD_COLLATERAL_SEED).toEqual(Buffer.from('yield-collateral'));
  });
});

// ─── initYieldCollateral ─────────────────────────────────────────────────────

describe('YieldCollateralModule — initYieldCollateral', () => {
  it('calls program.methods.initYieldCollateral with empty initialMints when not supplied', async () => {
    const rpcMock = vi.fn().mockResolvedValue('sig_init_empty');
    const accountsMock = vi.fn().mockReturnThis();
    const methodsMock = vi.fn().mockReturnValue({ accounts: accountsMock });
    accountsMock.mockReturnValue({ rpc: rpcMock });

    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = { methods: { initYieldCollateral: methodsMock }, account: {} };

    const sig = await mod.initYieldCollateral({ mint: makeKey('mint') });
    expect(methodsMock).toHaveBeenCalledWith([]);
    expect(sig).toBe('sig_init_empty');
  });

  it('passes initialMints through to the instruction', async () => {
    const stSol = makeKey('stSOL');
    const mSol = makeKey('mSOL');
    const rpcMock = vi.fn().mockResolvedValue('sig_init_mints');
    const accountsMock = vi.fn().mockReturnValue({ rpc: rpcMock });
    const methodsMock = vi.fn().mockReturnValue({ accounts: accountsMock });

    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = { methods: { initYieldCollateral: methodsMock }, account: {} };

    const sig = await mod.initYieldCollateral({
      mint: makeKey('mint'),
      initialMints: [stSol, mSol],
    });
    expect(methodsMock).toHaveBeenCalledWith([stSol, mSol]);
    expect(sig).toBe('sig_init_mints');
  });
});

// ─── addYieldCollateralMint ───────────────────────────────────────────────────

describe('YieldCollateralModule — addYieldCollateralMint', () => {
  it('calls program.methods.addYieldCollateralMint with the collateralMint', async () => {
    const jitoSol = makeKey('jitoSOL');
    const rpcMock = vi.fn().mockResolvedValue('sig_add');
    const accountsMock = vi.fn().mockReturnValue({ rpc: rpcMock });
    const methodsMock = vi.fn().mockReturnValue({ accounts: accountsMock });

    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = { methods: { addYieldCollateralMint: methodsMock }, account: {} };

    const sig = await mod.addYieldCollateralMint({
      mint: makeKey('mint'),
      collateralMint: jitoSol,
    });
    expect(methodsMock).toHaveBeenCalledWith(jitoSol);
    expect(sig).toBe('sig_add');
  });
});

// ─── fetchYieldCollateralConfig ───────────────────────────────────────────────

describe('YieldCollateralModule — fetchYieldCollateralConfig', () => {
  it('returns decoded config when account exists', async () => {
    const mint = makeKey('mint');
    const stSol = makeKey('stSOL');
    const mSol = makeKey('mSOL');
    const rawAccount = {
      sssMint: mint,
      whitelistedMints: [stSol, mSol],
      bump: 254,
    };

    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockResolvedValue(rawAccount),
        },
      },
    };

    const cfg = await mod.fetchYieldCollateralConfig(mint);
    expect(cfg).not.toBeNull();
    expect(cfg!.sssMint.equals(mint)).toBe(true);
    expect(cfg!.whitelistedMints).toHaveLength(2);
    expect(cfg!.whitelistedMints[0].equals(stSol)).toBe(true);
    expect(cfg!.whitelistedMints[1].equals(mSol)).toBe(true);
    expect(cfg!.bump).toBe(254);
  });

  it('returns null when account does not exist', async () => {
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockRejectedValue(new Error('Account does not exist')),
        },
      },
    };

    const cfg = await mod.fetchYieldCollateralConfig(makeKey('mint'));
    expect(cfg).toBeNull();
  });

  it('returns empty whitelistedMints array when none exist', async () => {
    const mint = makeKey('mint');
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockResolvedValue({
            sssMint: mint,
            whitelistedMints: [],
            bump: 253,
          }),
        },
      },
    };

    const cfg = await mod.fetchYieldCollateralConfig(mint);
    expect(cfg!.whitelistedMints).toHaveLength(0);
  });
});

// ─── isWhitelisted ────────────────────────────────────────────────────────────

describe('YieldCollateralModule — isWhitelisted', () => {
  it('returns true when collateralMint is in whitelist', async () => {
    const mint = makeKey('mint');
    const stSol = makeKey('stSOL');
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockResolvedValue({
            sssMint: mint,
            whitelistedMints: [stSol],
            bump: 254,
          }),
        },
      },
    };

    expect(await mod.isWhitelisted(mint, stSol)).toBe(true);
  });

  it('returns false when collateralMint is NOT in whitelist', async () => {
    const mint = makeKey('mint');
    const stSol = makeKey('stSOL');
    const other = makeKey('other');
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockResolvedValue({
            sssMint: mint,
            whitelistedMints: [stSol],
            bump: 254,
          }),
        },
      },
    };

    expect(await mod.isWhitelisted(mint, other)).toBe(false);
  });

  it('returns false when YieldCollateralConfig does not exist', async () => {
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockRejectedValue(new Error('Account does not exist')),
        },
      },
    };

    expect(await mod.isWhitelisted(makeKey('mint'), makeKey('stSOL'))).toBe(false);
  });

  it('handles up to 8 whitelisted mints', async () => {
    const mint = makeKey('mint');
    const mints = Array.from({ length: 8 }, (_, i) => makeKey(`mint_${i}`));
    const mod = new YieldCollateralModule(mockProvider(), PROGRAM_ID);
    (mod as any)._program = {
      methods: {},
      account: {
        yieldCollateralConfig: {
          fetch: vi.fn().mockResolvedValue({
            sssMint: mint,
            whitelistedMints: mints,
            bump: 250,
          }),
        },
      },
    };

    for (const m of mints) {
      expect(await mod.isWhitelisted(mint, m)).toBe(true);
    }
    expect(await mod.isWhitelisted(mint, makeKey('not_in_list'))).toBe(false);
  });
});
