import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  StabilityFeeModule,
  MAX_STABILITY_FEE_BPS,
  SECS_PER_YEAR,
} from './StabilityFeeModule';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROGRAM_ID = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const OWNER = Keypair.generate().publicKey;
const DEBTOR_TOKEN_ACCOUNT = Keypair.generate().publicKey;

/**
 * Build a fake StablecoinConfig account buffer.
 *
 * Layout tail (SSS-092/093 fields, bytes from the end):
 *   [-1]      bump: u8
 *   [-3..-1]  max_oracle_conf_bps: u16 LE  (SSS-090)
 *   [-7..-3]  max_oracle_age_secs: u32 LE  (SSS-090)
 *   [-9..-7]  redemption_fee_bps: u16 LE   (SSS-093)
 *   [-11..-9] stability_fee_bps: u16 LE    (SSS-092)
 */
function buildConfigData(
  stabilityFeeBps: number,
  opts: {
    redemptionFeeBps?: number;
    maxOracleAgeSecs?: number;
    maxOracleConfBps?: number;
    totalLen?: number;
  } = {},
): Buffer {
  const totalLen = opts.totalLen ?? 300;
  const buf = Buffer.alloc(totalLen, 0xab);
  buf.writeUInt16LE(stabilityFeeBps, totalLen - 11);
  buf.writeUInt16LE(opts.redemptionFeeBps ?? 0, totalLen - 9);
  buf.writeUInt32LE(opts.maxOracleAgeSecs ?? 60, totalLen - 7);
  buf.writeUInt16LE(opts.maxOracleConfBps ?? 100, totalLen - 3);
  buf.writeUInt8(255, totalLen - 1); // bump
  return buf;
}

/**
 * Build a fake CdpPosition account buffer.
 *
 * Fixed layout (state.rs, SSS-092):
 *   [0..8]    discriminator
 *   [8..40]   config: Pubkey
 *   [40..72]  sss_mint: Pubkey
 *   [72..104] owner: Pubkey
 *   [104..112] debt_amount: u64 LE
 *   [112..144] collateral_mint: Pubkey
 *   [144..152] last_fee_accrual: i64 LE
 *   [152..160] accrued_fees: u64 LE
 *   [160]     bump: u8
 */
function buildCdpPositionData(
  debtAmount: bigint,
  lastFeeAccrual: bigint,
  accruedFees: bigint,
): Buffer {
  const buf = Buffer.alloc(161, 0);
  buf.writeBigUInt64LE(debtAmount, 104);
  buf.writeBigInt64LE(lastFeeAccrual, 144);
  buf.writeBigUInt64LE(accruedFees, 152);
  return buf;
}

function mockProvider(
  configData?: Buffer,
  cdpData?: Buffer,
) {
  return {
    wallet: { publicKey: OWNER },
    connection: {
      getAccountInfo: vi.fn().mockImplementation(async (pubkey: PublicKey) => {
        const key = pubkey.toBase58();
        // Return cdpData for CDP PDAs, configData otherwise
        if (cdpData && key !== MINT.toBase58()) {
          // heuristic: if the requested key looks like a CDP PDA (not config), return cdpData
          // In tests we alternate via separate mock setups below
        }
        if (configData) {
          return { data: configData, lamports: 1_000_000, owner: PublicKey.default };
        }
        return null;
      }),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

function mockProviderMulti(
  configData: Buffer,
  cdpData: Buffer,
) {
  let callCount = 0;
  return {
    wallet: { publicKey: OWNER },
    connection: {
      getAccountInfo: vi.fn().mockImplementation(async () => {
        callCount++;
        // First call → config, subsequent → CDP
        if (callCount === 1) {
          return { data: configData, lamports: 1_000_000, owner: PublicKey.default };
        }
        return { data: cdpData, lamports: 1_000_000, owner: PublicKey.default };
      }),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StabilityFeeModule', () => {
  // ── Constants ─────────────────────────────────────────────────────────────

  it('MAX_STABILITY_FEE_BPS is 2000 (20%)', () => {
    expect(MAX_STABILITY_FEE_BPS).toBe(2000);
  });

  it('SECS_PER_YEAR equals 31536000', () => {
    expect(SECS_PER_YEAR).toBe(365 * 24 * 3600);
  });

  // ── PDA helpers ───────────────────────────────────────────────────────────

  describe('configPda', () => {
    it('derives deterministic PDA from mint', () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      const [pda1] = mod.configPda(MINT);
      const [pda2] = mod.configPda(MINT);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('produces different PDAs for different mints', () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      const mint2 = Keypair.generate().publicKey;
      const [pda1] = mod.configPda(MINT);
      const [pda2] = mod.configPda(mint2);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('cdpPositionPda', () => {
    it('derives deterministic PDA from mint + owner', () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      const [pda1] = mod.cdpPositionPda(MINT, OWNER);
      const [pda2] = mod.cdpPositionPda(MINT, OWNER);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('produces different PDAs for different owners', () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      const owner2 = Keypair.generate().publicKey;
      const [pda1] = mod.cdpPositionPda(MINT, OWNER);
      const [pda2] = mod.cdpPositionPda(MINT, owner2);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  // ── getStabilityFeeConfig ─────────────────────────────────────────────────

  describe('getStabilityFeeConfig', () => {
    it('reads stabilityFeeBps correctly', async () => {
      const data = buildConfigData(200);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      const config = await mod.getStabilityFeeConfig(MINT);
      expect(config.stabilityFeeBps).toBe(200);
    });

    it('returns 0 when fee is disabled', async () => {
      const data = buildConfigData(0);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      const config = await mod.getStabilityFeeConfig(MINT);
      expect(config.stabilityFeeBps).toBe(0);
    });

    it('reads MAX_STABILITY_FEE_BPS (2000)', async () => {
      const data = buildConfigData(MAX_STABILITY_FEE_BPS);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      const config = await mod.getStabilityFeeConfig(MINT);
      expect(config.stabilityFeeBps).toBe(2000);
    });

    it('throws when account not found', async () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      await expect(mod.getStabilityFeeConfig(MINT)).rejects.toThrow('not found');
    });
  });

  // ── getCdpStabilityFeeState ───────────────────────────────────────────────

  describe('getCdpStabilityFeeState', () => {
    it('reads lastFeeAccrual and accruedFees', async () => {
      const data = buildCdpPositionData(1_000_000n, 1_741_000_000n, 5_000n);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      const state = await mod.getCdpStabilityFeeState(MINT, OWNER);
      expect(state.lastFeeAccrual).toBe(1_741_000_000n);
      expect(state.accruedFees).toBe(5_000n);
    });

    it('returns zeros for fresh position (never accrued)', async () => {
      const data = buildCdpPositionData(500_000n, 0n, 0n);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      const state = await mod.getCdpStabilityFeeState(MINT, OWNER);
      expect(state.lastFeeAccrual).toBe(0n);
      expect(state.accruedFees).toBe(0n);
    });

    it('throws when CDP account not found', async () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      await expect(mod.getCdpStabilityFeeState(MINT, OWNER)).rejects.toThrow('not found');
    });
  });

  // ── isFeeEnabled ─────────────────────────────────────────────────────────

  describe('isFeeEnabled', () => {
    it('returns true when feeBps > 0', async () => {
      const data = buildConfigData(100);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      expect(await mod.isFeeEnabled(MINT)).toBe(true);
    });

    it('returns false when feeBps = 0', async () => {
      const data = buildConfigData(0);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      expect(await mod.isFeeEnabled(MINT)).toBe(false);
    });
  });

  // ── annualFeeRate ─────────────────────────────────────────────────────────

  describe('annualFeeRate', () => {
    it('returns 0.02 for 200 bps (2%)', async () => {
      const data = buildConfigData(200);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      expect(await mod.annualFeeRate(MINT)).toBeCloseTo(0.02);
    });

    it('returns 0 when fee disabled', async () => {
      const data = buildConfigData(0);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      expect(await mod.annualFeeRate(MINT)).toBe(0);
    });

    it('returns 0.2 for MAX_STABILITY_FEE_BPS (20%)', async () => {
      const data = buildConfigData(2000);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      expect(await mod.annualFeeRate(MINT)).toBeCloseTo(0.2);
    });
  });

  // ── setStabilityFee ───────────────────────────────────────────────────────

  describe('setStabilityFee', () => {
    it('sends a transaction and returns signature', async () => {
      const data = buildConfigData(0);
      const provider = mockProvider(data);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      const sig = await mod.setStabilityFee({ mint: MINT, feeBps: 200 });
      expect(sig).toBe('mockedTxSig');
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
    });

    it('throws when feeBps exceeds MAX (2001)', async () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      await expect(
        mod.setStabilityFee({ mint: MINT, feeBps: 2001 }),
      ).rejects.toThrow('2000');
    });

    it('allows feeBps = 0 (disable fee)', async () => {
      const data = buildConfigData(100);
      const provider = mockProvider(data);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      await expect(
        mod.setStabilityFee({ mint: MINT, feeBps: 0 }),
      ).resolves.toBe('mockedTxSig');
    });

    it('allows feeBps = MAX_STABILITY_FEE_BPS (2000)', async () => {
      const data = buildConfigData(0);
      const provider = mockProvider(data);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      const sig = await mod.setStabilityFee({ mint: MINT, feeBps: MAX_STABILITY_FEE_BPS });
      expect(sig).toBe('mockedTxSig');
    });

    it('throws for negative feeBps', async () => {
      const mod = new StabilityFeeModule(mockProvider(), PROGRAM_ID);
      await expect(
        mod.setStabilityFee({ mint: MINT, feeBps: -1 }),
      ).rejects.toThrow();
    });
  });

  // ── collectStabilityFee ───────────────────────────────────────────────────

  describe('collectStabilityFee', () => {
    it('returns null when stability fee is 0 (no-op)', async () => {
      const data = buildConfigData(0);
      const mod = new StabilityFeeModule(mockProvider(data), PROGRAM_ID);
      const result = await mod.collectStabilityFee({
        mint: MINT,
        debtor: OWNER,
        debtorSssAccount: DEBTOR_TOKEN_ACCOUNT,
      });
      expect(result).toBeNull();
    });

    it('sends transaction and returns signature when fee > 0', async () => {
      const configData = buildConfigData(200);
      const provider = mockProvider(configData);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      const sig = await mod.collectStabilityFee({
        mint: MINT,
        debtor: OWNER,
        debtorSssAccount: DEBTOR_TOKEN_ACCOUNT,
      });
      expect(sig).toBe('mockedTxSig');
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
    });
  });

  // ── previewAccruedFee ─────────────────────────────────────────────────────

  describe('previewAccruedFee', () => {
    it('returns zero estimatedFee when fee is disabled', async () => {
      const configData = buildConfigData(0);
      const cdpData = buildCdpPositionData(1_000_000n, 1_700_000_000n, 0n);
      const provider = mockProviderMulti(configData, cdpData);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      const preview = await mod.previewAccruedFee(MINT, OWNER);
      expect(preview.estimatedFee).toBe(0n);
      expect(preview.feeBps).toBe(0);
    });

    it('returns positive estimatedFee when fee > 0 and time has elapsed', async () => {
      const configData = buildConfigData(200); // 2% p.a.
      // Debt = 1_000_000 tokens, last accrual 1 year ago
      const oneYearAgo = BigInt(Math.floor(Date.now() / 1000) - SECS_PER_YEAR);
      const cdpData = buildCdpPositionData(1_000_000n, oneYearAgo, 0n);
      const provider = mockProviderMulti(configData, cdpData);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      const preview = await mod.previewAccruedFee(MINT, OWNER);
      // Expected: ~1_000_000 * 200 / 10_000 = 20_000 (2% of debt)
      expect(preview.estimatedFee).toBeGreaterThan(0n);
      expect(preview.feeBps).toBe(200);
      expect(preview.debtAmount).toBe(1_000_000n);
    });

    it('returns zero for fresh position (lastFeeAccrual = 0)', async () => {
      const configData = buildConfigData(500);
      const cdpData = buildCdpPositionData(1_000_000n, 0n, 0n);
      const provider = mockProviderMulti(configData, cdpData);
      const mod = new StabilityFeeModule(provider, PROGRAM_ID);
      const preview = await mod.previewAccruedFee(MINT, OWNER);
      expect(preview.estimatedFee).toBe(0n);
      expect(preview.elapsedSecs).toBe(0n);
    });
  });
});
