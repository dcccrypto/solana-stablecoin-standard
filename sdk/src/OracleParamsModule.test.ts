import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  OracleParamsModule,
  DEFAULT_MAX_ORACLE_AGE_SECS,
  MAX_ORACLE_AGE_SECONDS,
  RECOMMENDED_MAX_ORACLE_CONF_BPS,
} from './OracleParamsModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockProvider(accountData?: Buffer) {
  return {
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(
        accountData ? { data: accountData, lamports: 1_000_000, owner: PublicKey.default } : null,
      ),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

const PROGRAM_ID = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;

/**
 * Build a fake StablecoinConfig account buffer.
 * Last 7 bytes (before trailing bump byte):
 *   bytes[-7..-3]: max_oracle_age_secs (u32 LE)
 *   bytes[-3..-1]: max_oracle_conf_bps (u16 LE)
 *   byte[-1]:      bump (u8)
 */
function buildConfigData(maxAgeSecs: number, maxConfBps: number, totalLen = 300): Buffer {
  const buf = Buffer.alloc(totalLen, 0xab); // fill with garbage to simulate real fields
  buf.writeUInt32LE(maxAgeSecs, totalLen - 7);
  buf.writeUInt16LE(maxConfBps, totalLen - 3);
  buf.writeUInt8(255, totalLen - 1); // bump = 255
  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OracleParamsModule', () => {
  // ── Constants ───────────────────────────────────────────────────────────

  it('DEFAULT_MAX_ORACLE_AGE_SECS is 60', () => {
    expect(DEFAULT_MAX_ORACLE_AGE_SECS).toBe(60);
  });

  it('MAX_ORACLE_AGE_SECONDS equals DEFAULT_MAX_ORACLE_AGE_SECS', () => {
    expect(MAX_ORACLE_AGE_SECONDS).toBe(DEFAULT_MAX_ORACLE_AGE_SECS);
  });

  it('RECOMMENDED_MAX_ORACLE_CONF_BPS is 100 (1%)', () => {
    expect(RECOMMENDED_MAX_ORACLE_CONF_BPS).toBe(100);
  });

  // ── getOracleParams ──────────────────────────────────────────────────────

  describe('getOracleParams', () => {
    it('returns correct values from account data', async () => {
      const data = buildConfigData(60, 100);
      const mod = new OracleParamsModule(mockProvider(data), PROGRAM_ID);
      const params = await mod.getOracleParams(MINT);
      expect(params.maxAgeSecs).toBe(60);
      expect(params.maxConfBps).toBe(100);
    });

    it('returns zeros when both fields are zero (checks disabled)', async () => {
      const data = buildConfigData(0, 0);
      const mod = new OracleParamsModule(mockProvider(data), PROGRAM_ID);
      const params = await mod.getOracleParams(MINT);
      expect(params.maxAgeSecs).toBe(0);
      expect(params.maxConfBps).toBe(0);
    });

    it('handles large maxAgeSecs (u32 max = 4294967295)', async () => {
      const data = buildConfigData(0xffffffff, 0xffff);
      const mod = new OracleParamsModule(mockProvider(data), PROGRAM_ID);
      const params = await mod.getOracleParams(MINT);
      expect(params.maxAgeSecs).toBe(0xffffffff);
      expect(params.maxConfBps).toBe(0xffff);
    });

    it('throws when config PDA account is missing', async () => {
      const mod = new OracleParamsModule(mockProvider(undefined), PROGRAM_ID);
      await expect(mod.getOracleParams(MINT)).rejects.toThrow('StablecoinConfig PDA not found');
    });
  });

  // ── isConfidenceCheckEnabled ──────────────────────────────────────────────

  describe('isConfidenceCheckEnabled', () => {
    it('returns true when maxConfBps > 0', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      expect(await mod.isConfidenceCheckEnabled(MINT)).toBe(true);
    });

    it('returns false when maxConfBps === 0', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 0)), PROGRAM_ID);
      expect(await mod.isConfidenceCheckEnabled(MINT)).toBe(false);
    });
  });

  // ── effectiveMaxAgeSecs ───────────────────────────────────────────────────

  describe('effectiveMaxAgeSecs', () => {
    it('returns DEFAULT_MAX_ORACLE_AGE_SECS when maxAgeSecs is 0', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(0, 100)), PROGRAM_ID);
      expect(await mod.effectiveMaxAgeSecs(MINT)).toBe(DEFAULT_MAX_ORACLE_AGE_SECS);
    });

    it('returns the configured value when non-zero', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(120, 50)), PROGRAM_ID);
      expect(await mod.effectiveMaxAgeSecs(MINT)).toBe(120);
    });

    it('returns 300 for a loose devnet configuration', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(300, 0)), PROGRAM_ID);
      expect(await mod.effectiveMaxAgeSecs(MINT)).toBe(300);
    });
  });

  // ── setOracleParams validation ─────────────────────────────────────────────

  describe('setOracleParams input validation', () => {
    it('rejects negative maxAgeSecs', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      await expect(mod.setOracleParams({ mint: MINT, maxAgeSecs: -1, maxConfBps: 100 }))
        .rejects.toThrow('maxAgeSecs must be a u32');
    });

    it('rejects maxAgeSecs above u32 max', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      await expect(mod.setOracleParams({ mint: MINT, maxAgeSecs: 5_000_000_000, maxConfBps: 100 }))
        .rejects.toThrow('maxAgeSecs must be a u32');
    });

    it('rejects negative maxConfBps', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      await expect(mod.setOracleParams({ mint: MINT, maxAgeSecs: 60, maxConfBps: -1 }))
        .rejects.toThrow('maxConfBps must be a u16');
    });

    it('rejects maxConfBps above u16 max', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      await expect(mod.setOracleParams({ mint: MINT, maxAgeSecs: 60, maxConfBps: 70_000 }))
        .rejects.toThrow('maxConfBps must be a u16');
    });

    it('accepts zero values (disable both checks)', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      await expect(mod.setOracleParams({ mint: MINT, maxAgeSecs: 0, maxConfBps: 0 }))
        .resolves.toBe('mockedTxSig');
    });

    it('accepts recommended mainnet values', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      await expect(
        mod.setOracleParams({ mint: MINT, maxAgeSecs: 60, maxConfBps: RECOMMENDED_MAX_ORACLE_CONF_BPS }),
      ).resolves.toBe('mockedTxSig');
    });
  });

  // ── fetchOracleParams (SSS-094 alias) ─────────────────────────────────────

  describe('fetchOracleParams', () => {
    it('returns same result as getOracleParams', async () => {
      const data = buildConfigData(90, 200);
      const mod = new OracleParamsModule(mockProvider(data), PROGRAM_ID);
      const via_get = await mod.getOracleParams(MINT);
      const via_fetch = await mod.fetchOracleParams(MINT);
      expect(via_fetch).toEqual(via_get);
    });

    it('throws when config PDA is missing', async () => {
      const mod = new OracleParamsModule(mockProvider(undefined), PROGRAM_ID);
      await expect(mod.fetchOracleParams(MINT)).rejects.toThrow('StablecoinConfig PDA not found');
    });
  });

  // ── validateOracleFeed ────────────────────────────────────────────────────

  describe('validateOracleFeed', () => {
    it('returns valid when price is fresh and conf within limit', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      const result = await mod.validateOracleFeed(MINT, 30, 50);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns invalid when price is stale', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      const result = await mod.validateOracleFeed(MINT, 61, 50);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/stale/);
    });

    it('returns invalid when conf is too wide', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      const result = await mod.validateOracleFeed(MINT, 30, 101);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/confidence/i);
    });

    it('uses DEFAULT_MAX_ORACLE_AGE_SECS when maxAgeSecs is 0', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(0, 100)), PROGRAM_ID);
      // 60s is the default; 59s should pass
      const result = await mod.validateOracleFeed(MINT, 59, 50);
      expect(result.valid).toBe(true);
    });

    it('rejects exactly at staleness boundary', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      const result = await mod.validateOracleFeed(MINT, 60, 50);
      // age === maxAge is still valid (not > maxAge)
      expect(result.valid).toBe(true);
    });

    it('skips conf check when maxConfBps is 0', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 0)), PROGRAM_ID);
      // even extreme conf should pass when check is disabled
      const result = await mod.validateOracleFeed(MINT, 30, 9999);
      expect(result.valid).toBe(true);
    });

    it('staleness check takes priority over conf check', async () => {
      const mod = new OracleParamsModule(mockProvider(buildConfigData(60, 100)), PROGRAM_ID);
      // both stale AND wide conf — should fail on staleness first
      const result = await mod.validateOracleFeed(MINT, 120, 500);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/stale/);
    });
  });
});
