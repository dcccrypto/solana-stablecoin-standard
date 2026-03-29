import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  YieldCollateralModule,
  FLAG_YIELD_COLLATERAL,
  type InitYieldCollateralParams,
  type AddYieldCollateralMintParams,
  type RemoveYieldCollateralMintParams,
} from './YieldCollateralModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID    = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const ADMIN         = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT          = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const MINT_B        = new PublicKey('95yogXJdMH6TtZwD4WazNjXB3rFe9MsN4X7V2hLsUG3p');
const ST_SOL_MINT   = new PublicKey('7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj');
const M_SOL_MINT    = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

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

function makeMockProgram(txSig = 'tx-sig-mock', fetchResult: any = null) {
  const rpc = vi.fn().mockResolvedValue(txSig);
  const accounts = vi.fn().mockReturnThis();
  const methodsChain = { accounts, rpc } as any;

  return {
    methods: new Proxy(
      {},
      { get: () => () => methodsChain }
    ),
    account: {
      yieldCollateralConfig: {
        fetch: fetchResult
          ? vi.fn().mockResolvedValue(fetchResult)
          : vi.fn().mockRejectedValue(new Error('Account not found')),
      },
    },
  } as any;
}

/**
 * Build a minimal StablecoinConfig buffer with specific feature_flags.
 */
function buildConfigData(featureFlags: bigint): Buffer {
  const buf = Buffer.alloc(200, 0);
  buf.writeBigUInt64LE(featureFlags, 169);
  return buf;
}

// ─── FLAG_YIELD_COLLATERAL constant ───────────────────────────────────────────

describe('FLAG_YIELD_COLLATERAL', () => {
  it('equals 8n (bit 3)', () => {
    expect(FLAG_YIELD_COLLATERAL).toBe(8n);
  });

  it('equals 1n << 3n', () => {
    expect(FLAG_YIELD_COLLATERAL).toBe(1n << 3n);
  });

  it('does not overlap with FLAG_CIRCUIT_BREAKER_V2 (bit 0)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 0n)).toBe(0n);
  });

  it('does not overlap with FLAG_SPEND_POLICY (bit 1)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 1n)).toBe(0n);
  });

  it('does not overlap with FLAG_DAO_COMMITTEE (bit 2)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 2n)).toBe(0n);
  });

  it('does not overlap with FLAG_ZK_COMPLIANCE (bit 4)', () => {
    expect(FLAG_YIELD_COLLATERAL & (1n << 4n)).toBe(0n);
  });
});

// ─── getConfigPda ──────────────────────────────────────────────────────────────

describe('YieldCollateralModule.getConfigPda', () => {
  let yc: YieldCollateralModule;

  beforeEach(() => {
    yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns a tuple of [PublicKey, number]', () => {
    const [pda, bump] = yc.getConfigPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe('number');
  });

  it('is deterministic — same mint yields same PDA', () => {
    const [pda1] = yc.getConfigPda(MINT);
    const [pda2] = yc.getConfigPda(MINT);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it('produces different PDAs for different mints', () => {
    const [pda1] = yc.getConfigPda(MINT);
    const [pda2] = yc.getConfigPda(MINT_B);
    expect(pda1.equals(pda2)).toBe(false);
  });
});

// ─── getYieldCollateralConfigPda ──────────────────────────────────────────────

describe('YieldCollateralModule.getYieldCollateralConfigPda', () => {
  let yc: YieldCollateralModule;

  beforeEach(() => {
    yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns a tuple of [PublicKey, number]', () => {
    const [pda, bump] = yc.getYieldCollateralConfigPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe('number');
  });

  it('is deterministic — same mint yields same PDA', () => {
    const [pda1] = yc.getYieldCollateralConfigPda(MINT);
    const [pda2] = yc.getYieldCollateralConfigPda(MINT);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it('produces different PDAs for different mints', () => {
    const [pda1] = yc.getYieldCollateralConfigPda(MINT);
    const [pda2] = yc.getYieldCollateralConfigPda(MINT_B);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it('produces a different PDA from getConfigPda for the same mint', () => {
    const [configPda] = yc.getConfigPda(MINT);
    const [ycConfigPda] = yc.getYieldCollateralConfigPda(MINT);
    expect(configPda.equals(ycConfigPda)).toBe(false);
  });
});

// ─── initYieldCollateral ──────────────────────────────────────────────────────

describe('YieldCollateralModule.initYieldCollateral', () => {
  let yc: YieldCollateralModule;
  let mockProgram: any;

  beforeEach(() => {
    yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('init-yc-sig');
    (yc as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await yc.initYieldCollateral({ mint: MINT });
    expect(sig).toBe('init-yc-sig');
  });

  it('handles empty initialMints (defaults to [])', async () => {
    const sig = await yc.initYieldCollateral({ mint: MINT });
    expect(sig).toBe('init-yc-sig');
  });

  it('passes initialMints to the instruction', async () => {
    await yc.initYieldCollateral({ mint: MINT, initialMints: [ST_SOL_MINT] });
    // method was called (mock returns regardless)
    const [configPda] = yc.getConfigPda(MINT);
    const [ycPda] = yc.getYieldCollateralConfigPda(MINT);
    expect(mockProgram.methods.initYieldCollateral().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      config: configPda,
      mint: MINT,
      yieldCollateralConfig: ycPda,
    });
  });

  it('calls rpc with confirmed commitment', async () => {
    await yc.initYieldCollateral({ mint: MINT });
    expect(mockProgram.methods.initYieldCollateral().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });
});

// ─── addCollateralMint ────────────────────────────────────────────────────────

describe('YieldCollateralModule.addCollateralMint', () => {
  let yc: YieldCollateralModule;
  let mockProgram: any;

  beforeEach(() => {
    yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('add-mint-sig');
    (yc as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await yc.addCollateralMint({ mint: MINT, collateralMint: ST_SOL_MINT });
    expect(sig).toBe('add-mint-sig');
  });

  it('calls accounts() with authority, config, mint, yieldCollateralConfig', async () => {
    await yc.addCollateralMint({ mint: MINT, collateralMint: M_SOL_MINT });
    const [configPda] = yc.getConfigPda(MINT);
    const [ycPda] = yc.getYieldCollateralConfigPda(MINT);
    expect(mockProgram.methods.addYieldCollateralMint().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      config: configPda,
      mint: MINT,
      yieldCollateralConfig: ycPda,
    });
  });

  it('calls rpc with confirmed commitment', async () => {
    await yc.addCollateralMint({ mint: MINT, collateralMint: ST_SOL_MINT });
    expect(mockProgram.methods.addYieldCollateralMint().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });
});

// ─── removeCollateralMint ─────────────────────────────────────────────────────

describe('YieldCollateralModule.removeCollateralMint', () => {
  let yc: YieldCollateralModule;
  let mockProgram: any;

  beforeEach(() => {
    yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('remove-mint-sig');
    (yc as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await yc.removeCollateralMint({ mint: MINT, collateralMint: ST_SOL_MINT });
    expect(sig).toBe('remove-mint-sig');
  });

  it('calls accounts() with authority, config, mint, yieldCollateralConfig', async () => {
    await yc.removeCollateralMint({ mint: MINT, collateralMint: ST_SOL_MINT });
    const [configPda] = yc.getConfigPda(MINT);
    const [ycPda] = yc.getYieldCollateralConfigPda(MINT);
    expect(mockProgram.methods.removeYieldCollateralMint().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      config: configPda,
      mint: MINT,
      yieldCollateralConfig: ycPda,
    });
  });

  it('calls rpc with confirmed commitment', async () => {
    await yc.removeCollateralMint({ mint: MINT, collateralMint: ST_SOL_MINT });
    expect(mockProgram.methods.removeYieldCollateralMint().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });
});

// ─── isActive ─────────────────────────────────────────────────────────────────

describe('YieldCollateralModule.isActive', () => {
  it('returns false when account does not exist', async () => {
    const yc = new YieldCollateralModule(makeMockProvider(null), PROGRAM_ID);
    expect(await yc.isActive(MINT)).toBe(false);
  });

  it('returns true when FLAG_YIELD_COLLATERAL (bit 3) is set', async () => {
    const data = buildConfigData(FLAG_YIELD_COLLATERAL);
    const yc = new YieldCollateralModule(makeMockProvider(data), PROGRAM_ID);
    expect(await yc.isActive(MINT)).toBe(true);
  });

  it('returns false when FLAG_YIELD_COLLATERAL is not set', async () => {
    const data = buildConfigData(1n << 1n); // only spend policy
    const yc = new YieldCollateralModule(makeMockProvider(data), PROGRAM_ID);
    expect(await yc.isActive(MINT)).toBe(false);
  });

  it('returns true when multiple flags are set including bit 3', async () => {
    const flags = (1n << 1n) | (1n << 3n) | (1n << 4n);
    const data = buildConfigData(flags);
    const yc = new YieldCollateralModule(makeMockProvider(data), PROGRAM_ID);
    expect(await yc.isActive(MINT)).toBe(true);
  });

  it('returns false when account data is too short', async () => {
    const shortData = Buffer.alloc(5, 0);
    const yc = new YieldCollateralModule(makeMockProvider(shortData), PROGRAM_ID);
    expect(await yc.isActive(MINT)).toBe(false);
  });
});

// ─── getWhitelistedMints ──────────────────────────────────────────────────────

describe('YieldCollateralModule.getWhitelistedMints', () => {
  it('returns empty array when account does not exist', async () => {
    const yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    const mockProgram = makeMockProgram('sig', null); // fetch throws
    (yc as any)._program = mockProgram;
    const result = await yc.getWhitelistedMints(MINT);
    expect(result).toEqual([]);
  });

  it('returns array of whitelisted PublicKeys', async () => {
    const yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    const mockProgram = makeMockProgram('sig', {
      whitelistedMints: [ST_SOL_MINT, M_SOL_MINT],
    });
    (yc as any)._program = mockProgram;
    const result = await yc.getWhitelistedMints(MINT);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(ST_SOL_MINT);
    expect(result[1]).toEqual(M_SOL_MINT);
  });

  it('returns empty array when whitelistedMints is empty', async () => {
    const yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    const mockProgram = makeMockProgram('sig', { whitelistedMints: [] });
    (yc as any)._program = mockProgram;
    const result = await yc.getWhitelistedMints(MINT);
    expect(result).toEqual([]);
  });

  it('handles null whitelistedMints gracefully', async () => {
    const yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    const mockProgram = makeMockProgram('sig', { whitelistedMints: null });
    (yc as any)._program = mockProgram;
    const result = await yc.getWhitelistedMints(MINT);
    expect(result).toEqual([]);
  });

  it('calls fetch with the correct YieldCollateralConfig PDA', async () => {
    const yc = new YieldCollateralModule(makeMockProvider(), PROGRAM_ID);
    const mockProgram = makeMockProgram('sig', { whitelistedMints: [ST_SOL_MINT] });
    (yc as any)._program = mockProgram;
    await yc.getWhitelistedMints(MINT);
    const [ycPda] = yc.getYieldCollateralConfigPda(MINT);
    expect(mockProgram.account.yieldCollateralConfig.fetch).toHaveBeenCalledWith(ycPda);
  });
});
