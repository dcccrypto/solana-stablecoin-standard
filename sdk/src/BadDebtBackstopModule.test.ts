import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  BadDebtBackstopModule,
  MAX_BACKSTOP_BPS,
} from './BadDebtBackstopModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockProvider(accountData?: Buffer) {
  return {
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(
        accountData
          ? { data: accountData, lamports: 1_000_000, owner: PublicKey.default }
          : null,
      ),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

const PROGRAM_ID = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;

/**
 * Build a fake StablecoinConfig buffer with SSS-097 fields at tail.
 * Layout (tail):
 *   [-1]      bump: u8
 *   [-3..-1]  max_oracle_conf_bps: u16 LE (SSS-090)
 *   [-7..-3]  max_oracle_age_secs: u32 LE (SSS-090)
 *   [-9..-7]  redemption_fee_bps: u16 LE  (SSS-093)
 *   [-11..-9] stability_fee_bps: u16 LE   (SSS-092)
 *   [-13..-11] max_backstop_bps: u16 LE   (SSS-097)
 *   [-45..-13] insurance_fund_pubkey: [u8;32] (SSS-097)
 */
function buildConfigData(
  insuranceFundPubkey: PublicKey,
  maxBackstopBps: number,
  totalLen = 400,
): Buffer {
  const buf = Buffer.alloc(totalLen, 0xab);
  // SSS-097 fields at tail
  insuranceFundPubkey.toBuffer().copy(buf, totalLen - 45);
  buf.writeUInt16LE(maxBackstopBps, totalLen - 13);
  // SSS-092: stability_fee_bps = 0
  buf.writeUInt16LE(0, totalLen - 11);
  // SSS-093: redemption_fee_bps = 0
  buf.writeUInt16LE(0, totalLen - 9);
  // SSS-090
  buf.writeUInt32LE(60, totalLen - 7);
  buf.writeUInt16LE(100, totalLen - 3);
  buf.writeUInt8(255, totalLen - 1);
  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BadDebtBackstopModule', () => {
  // ── Constants ───────────────────────────────────────────────────────────

  it('MAX_BACKSTOP_BPS is 10_000', () => {
    expect(MAX_BACKSTOP_BPS).toBe(10_000);
  });

  // ── constructor & configPda ──────────────────────────────────────────────

  it('configPda derives a deterministic PDA from mint', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    const [pda1] = mod.configPda(MINT);
    const [pda2] = mod.configPda(MINT);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('configPda returns different addresses for different mints', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    const mint2 = Keypair.generate().publicKey;
    const [pda1] = mod.configPda(MINT);
    const [pda2] = mod.configPda(mint2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  // ── setBackstopParams ────────────────────────────────────────────────────

  it('setBackstopParams sends a transaction and returns a signature', async () => {
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const insuranceFundPubkey = Keypair.generate().publicKey;
    const sig = await mod.setBackstopParams({
      mint: MINT,
      insuranceFundPubkey,
      maxBackstopBps: 500,
    });
    expect(sig).toBe('mockedTxSig');
    expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
  });

  it('setBackstopParams throws when maxBackstopBps > 10_000', async () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    await expect(
      mod.setBackstopParams({
        mint: MINT,
        insuranceFundPubkey: Keypair.generate().publicKey,
        maxBackstopBps: 10_001,
      }),
    ).rejects.toThrow('maxBackstopBps must be 0–10000');
  });

  it('setBackstopParams throws when maxBackstopBps is negative', async () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    await expect(
      mod.setBackstopParams({
        mint: MINT,
        insuranceFundPubkey: Keypair.generate().publicKey,
        maxBackstopBps: -1,
      }),
    ).rejects.toThrow('maxBackstopBps must be 0–10000');
  });

  it('setBackstopParams accepts maxBackstopBps = 0 (unlimited)', async () => {
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const sig = await mod.setBackstopParams({
      mint: MINT,
      insuranceFundPubkey: Keypair.generate().publicKey,
      maxBackstopBps: 0,
    });
    expect(sig).toBe('mockedTxSig');
  });

  it('setBackstopParams accepts maxBackstopBps = 10_000 (boundary)', async () => {
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const sig = await mod.setBackstopParams({
      mint: MINT,
      insuranceFundPubkey: Keypair.generate().publicKey,
      maxBackstopBps: 10_000,
    });
    expect(sig).toBe('mockedTxSig');
  });

  it('setBackstopParams encodes PublicKey.default to disable backstop', async () => {
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const sig = await mod.setBackstopParams({
      mint: MINT,
      insuranceFundPubkey: PublicKey.default,
      maxBackstopBps: 0,
    });
    expect(sig).toBe('mockedTxSig');
  });

  // ── triggerBackstop ──────────────────────────────────────────────────────

  it('triggerBackstop sends a transaction and returns a signature', async () => {
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const sig = await mod.triggerBackstop({
      mint: MINT,
      cdpOwner: Keypair.generate().publicKey,
      oraclePriceFeed: Keypair.generate().publicKey,
      insuranceFund: Keypair.generate().publicKey,
      reserveVault: Keypair.generate().publicKey,
      collateralMint: Keypair.generate().publicKey,
      insuranceFundAuthority: Keypair.generate().publicKey,
      collateralTokenProgram: Keypair.generate().publicKey,
    });
    expect(sig).toBe('mockedTxSig');
    expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
  });

  it('triggerBackstop resolves config PDA and includes it in the transaction', async () => {
    // Shortfall is now computed on-chain (BUG-031); no client-side shortfallAmount param.
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const sig = await mod.triggerBackstop({
      mint: MINT,
      cdpOwner: Keypair.generate().publicKey,
      oraclePriceFeed: Keypair.generate().publicKey,
      insuranceFund: Keypair.generate().publicKey,
      reserveVault: Keypair.generate().publicKey,
      collateralMint: Keypair.generate().publicKey,
      insuranceFundAuthority: Keypair.generate().publicKey,
      collateralTokenProgram: Keypair.generate().publicKey,
    });
    expect(sig).toBe('mockedTxSig');
  });

  it('triggerBackstop requires mint to be a valid PublicKey', async () => {
    const provider = mockProvider();
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    // All required fields supplied — should resolve without error
    await expect(
      mod.triggerBackstop({
        mint: MINT,
        cdpOwner: Keypair.generate().publicKey,
        oraclePriceFeed: Keypair.generate().publicKey,
        insuranceFund: Keypair.generate().publicKey,
        reserveVault: Keypair.generate().publicKey,
        collateralMint: Keypair.generate().publicKey,
        insuranceFundAuthority: Keypair.generate().publicKey,
        collateralTokenProgram: Keypair.generate().publicKey,
      }),
    ).resolves.toBe('mockedTxSig');
  });

  // ── fetchBackstopConfig ──────────────────────────────────────────────────

  it('fetchBackstopConfig reads insurance_fund_pubkey and maxBackstopBps', async () => {
    const insuranceFund = Keypair.generate().publicKey;
    const provider = mockProvider(buildConfigData(insuranceFund, 500));
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const config = await mod.fetchBackstopConfig(MINT);
    expect(config.insuranceFundPubkey.toBase58()).toBe(insuranceFund.toBase58());
    expect(config.maxBackstopBps).toBe(500);
    expect(config.enabled).toBe(true);
  });

  it('fetchBackstopConfig reports enabled=false when insurance fund is default pubkey', async () => {
    const provider = mockProvider(buildConfigData(PublicKey.default, 0));
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const config = await mod.fetchBackstopConfig(MINT);
    expect(config.enabled).toBe(false);
  });

  it('fetchBackstopConfig throws when account not found', async () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    await expect(mod.fetchBackstopConfig(MINT)).rejects.toThrow(
      'StablecoinConfig PDA not found',
    );
  });

  it('fetchBackstopConfig reads maxBackstopBps = 10_000 (100%)', async () => {
    const insuranceFund = Keypair.generate().publicKey;
    const provider = mockProvider(buildConfigData(insuranceFund, 10_000));
    const mod = new BadDebtBackstopModule(provider, PROGRAM_ID);
    const config = await mod.fetchBackstopConfig(MINT);
    expect(config.maxBackstopBps).toBe(10_000);
  });

  // ── isBackstopEnabled ────────────────────────────────────────────────────

  it('isBackstopEnabled returns true when fund is configured', async () => {
    const fund = Keypair.generate().publicKey;
    const mod = new BadDebtBackstopModule(
      mockProvider(buildConfigData(fund, 500)),
      PROGRAM_ID,
    );
    expect(await mod.isBackstopEnabled(MINT)).toBe(true);
  });

  it('isBackstopEnabled returns false when fund is default pubkey', async () => {
    const mod = new BadDebtBackstopModule(
      mockProvider(buildConfigData(PublicKey.default, 0)),
      PROGRAM_ID,
    );
    expect(await mod.isBackstopEnabled(MINT)).toBe(false);
  });

  // ── computeMaxDraw ───────────────────────────────────────────────────────

  it('computeMaxDraw caps draw by shortfall when maxBackstopBps = 0 (unlimited)', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    const result = mod.computeMaxDraw({
      netSupply: 1_000_000n,
      maxBackstopBps: 0,
      shortfall: 40_000n,
    });
    expect(result).toBe(40_000n);
  });

  it('computeMaxDraw caps draw by bps cap when cap < shortfall', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    // 500 bps of 1_000_000 = 50_000; shortfall = 80_000 → draw = 50_000
    const result = mod.computeMaxDraw({
      netSupply: 1_000_000n,
      maxBackstopBps: 500,
      shortfall: 80_000n,
    });
    expect(result).toBe(50_000n);
  });

  it('computeMaxDraw caps draw by shortfall when shortfall < bps cap', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    // 500 bps of 1_000_000 = 50_000; shortfall = 30_000 → draw = 30_000
    const result = mod.computeMaxDraw({
      netSupply: 1_000_000n,
      maxBackstopBps: 500,
      shortfall: 30_000n,
    });
    expect(result).toBe(30_000n);
  });

  it('computeMaxDraw further caps draw by insurance fund balance', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    // cap=50_000, shortfall=80_000 → maxDraw=50_000; fund has only 20_000 → draw=20_000
    const result = mod.computeMaxDraw({
      netSupply: 1_000_000n,
      maxBackstopBps: 500,
      shortfall: 80_000n,
      insuranceFundBalance: 20_000n,
    });
    expect(result).toBe(20_000n);
  });

  it('computeMaxDraw returns 0 when netSupply is 0 and bps cap is set', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    const result = mod.computeMaxDraw({
      netSupply: 0n,
      maxBackstopBps: 500,
      shortfall: 10_000n,
    });
    expect(result).toBe(0n);
  });

  // ── computeRemainingShortfall ────────────────────────────────────────────

  it('computeRemainingShortfall returns 0 when fully covered', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    expect(mod.computeRemainingShortfall(50_000n, 50_000n)).toBe(0n);
  });

  it('computeRemainingShortfall returns 0 when draw > shortfall', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    expect(mod.computeRemainingShortfall(30_000n, 50_000n)).toBe(0n);
  });

  it('computeRemainingShortfall returns difference when partially covered', () => {
    const mod = new BadDebtBackstopModule(mockProvider(), PROGRAM_ID);
    expect(mod.computeRemainingShortfall(80_000n, 50_000n)).toBe(30_000n);
  });
});
