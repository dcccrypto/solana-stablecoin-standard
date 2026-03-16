/**
 * SSS-101: MultiCollateralLiquidationModule tests
 *
 * Tests cover:
 *  - PDA derivation helpers (4 tests)
 *  - calcLiquidationAmount pure math (12 tests)
 *  - fetchLiquidatableCDPs logic via mocked program (4 tests)
 *  - liquidate method account derivation (2 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

import {
  MultiCollateralLiquidationModule,
  calcLiquidationAmount,
  deriveCdpPositionPda,
  deriveCollateralVaultPda,
  deriveCollateralConfigPda,
  deriveStablecoinConfigPda,
  LIQUIDATION_THRESHOLD_BPS,
  DEFAULT_LIQUIDATION_BONUS_BPS,
  BPS_DENOMINATOR,
} from './MultiCollateralLiquidationModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Use real mainnet-like but deterministic pubkeys for tests
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const SSS_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USER = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const COLLATERAL_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const PYTH_FEED = new PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG');

// ─── 1. PDA derivation ────────────────────────────────────────────────────────

describe('PDA derivation', () => {
  it('deriveCdpPositionPda returns consistent result for same inputs', () => {
    const [pda1] = deriveCdpPositionPda(SSS_MINT, USER, PROGRAM_ID);
    const [pda2] = deriveCdpPositionPda(SSS_MINT, USER, PROGRAM_ID);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('deriveCdpPositionPda changes when owner changes', () => {
    const other = new PublicKey('7UX2i7SucgLMQcfZ75s3VXmZZY4YRUyJN9X1RgfMoDUi');
    const [pda1] = deriveCdpPositionPda(SSS_MINT, USER, PROGRAM_ID);
    const [pda2] = deriveCdpPositionPda(SSS_MINT, other, PROGRAM_ID);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  it('deriveCollateralVaultPda returns consistent result for same inputs', () => {
    const [pda1] = deriveCollateralVaultPda(SSS_MINT, USER, COLLATERAL_MINT, PROGRAM_ID);
    const [pda2] = deriveCollateralVaultPda(SSS_MINT, USER, COLLATERAL_MINT, PROGRAM_ID);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('deriveCollateralConfigPda is distinct from vault PDA', () => {
    const [vaultPda] = deriveCollateralVaultPda(SSS_MINT, USER, COLLATERAL_MINT, PROGRAM_ID);
    const [configPda] = deriveCollateralConfigPda(SSS_MINT, COLLATERAL_MINT, PROGRAM_ID);
    expect(vaultPda.toBase58()).not.toBe(configPda.toBase58());
  });

  it('deriveStablecoinConfigPda returns a valid pubkey', () => {
    const [pda] = deriveStablecoinConfigPda(SSS_MINT, PROGRAM_ID);
    expect(pda.toBase58()).toBeTruthy();
    expect(pda.toBase58().length).toBeGreaterThan(30);
  });
});

// ─── 2. calcLiquidationAmount — full liquidation ──────────────────────────────

describe('calcLiquidationAmount — full liquidation', () => {
  it('fullDebtToBurn equals total debt for a fully undercollateralised position', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n, // 1 SSS
      collateralUnits: 1_100_000n, // 1.1 collateral @ $1 = $1.10 (110% ratio)
      collateralPriceUsd: 1.0,
    });
    expect(result.fullDebtToBurn).toBe(1_000_000n);
  });

  it('collateral seized equals debt value in collateral units', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n, // $1 debt
      collateralUnits: 1_500_000n, // 1.5 units
      collateralPriceUsd: 1.0,    // $1 each → $1.50 collateral
    });
    // seized = 1_000_000 units (exactly repays $1 debt)
    expect(result.fullCollateralSeized).toBe(1_000_000n);
  });

  it('liquidation bonus is 5% of seized collateral by default', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 2_000_000n,
      collateralPriceUsd: 1.0,
    });
    // 5% of 1_000_000 = 50_000
    expect(result.liquidationBonus).toBe(50_000n);
  });

  it('totalCollateralToLiquidator = seized + bonus when vault has enough', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 2_000_000n,
      collateralPriceUsd: 1.0,
    });
    expect(result.totalCollateralToLiquidator).toBe(
      result.fullCollateralSeized + result.liquidationBonus,
    );
  });

  it('totalCollateralToLiquidator is capped at vault balance', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 1_000_100n, // barely above seized, not enough for bonus
      collateralPriceUsd: 1.0,
    });
    expect(result.totalCollateralToLiquidator).toBe(1_000_100n);
  });

  it('custom liquidation bonus is applied correctly', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 2_000_000n,
      collateralPriceUsd: 1.0,
      liquidationBonusBps: 1000, // 10%
    });
    expect(result.liquidationBonus).toBe(100_000n);
  });

  it('handles high collateral price correctly', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 100_000_000n, // $100 debt
      collateralUnits: 1_000_000n,  // 1 ETH-like unit
      collateralPriceUsd: 200.0,    // $200/unit → $200 collateral (200% ratio)
    });
    // seized = debt($100) / price($200) * scale(1e6) = 500_000
    expect(result.fullCollateralSeized).toBe(500_000n);
  });
});

// ─── 3. calcLiquidationAmount — partial liquidation ──────────────────────────

describe('calcLiquidationAmount — partial liquidation', () => {
  it('partialDebtToBurn is > 0 for undercollateralised position', () => {
    // Position: $1 debt, $1.10 collateral = 110% — below 120% threshold
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 1_100_000n,
      collateralPriceUsd: 1.0,
    });
    expect(result.partialDebtToBurn).toBeGreaterThan(0n);
  });

  it('partialDebtToBurn is 0 for healthy position (ratio >= 120%)', () => {
    // Position: $1 debt, $1.50 collateral = 150% — healthy
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 1_500_000n,
      collateralPriceUsd: 1.0,
    });
    expect(result.partialDebtToBurn).toBe(0n);
  });

  it('partialDebtToBurn <= fullDebtToBurn', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 1_100_000n,
      collateralPriceUsd: 1.0,
    });
    expect(result.partialDebtToBurn).toBeLessThanOrEqual(result.fullDebtToBurn);
  });

  it('partialCollateralSeized <= collateralUnits', () => {
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 1_050_000n, // very thin position
      collateralPriceUsd: 1.0,
    });
    expect(result.partialCollateralSeized).toBeLessThanOrEqual(1_050_000n);
  });

  it('partial liquidation of deeply undercollateralised position is still < full debt', () => {
    // Position: $1 debt, $0.50 collateral = 50% ratio (way underwater).
    // Partial path: burn enough to restore to 150%, which still leaves the
    // protocol with reduced debt (it can't recover if collateral < debt but
    // partial burn still makes the remaining ratio healthier).
    const result = calcLiquidationAmount({
      totalDebtUnits: 1_000_000n,
      collateralUnits: 500_000n,
      collateralPriceUsd: 1.0,
    });
    // partialDebtToBurn > 0 and <= fullDebtToBurn
    expect(result.partialDebtToBurn).toBeGreaterThan(0n);
    expect(result.partialDebtToBurn).toBeLessThanOrEqual(result.fullDebtToBurn);
    expect(result.partialCollateralSeized).toBeLessThanOrEqual(500_000n);
  });
});

// ─── 4. fetchLiquidatableCDPs — mocked ───────────────────────────────────────

describe('fetchLiquidatableCDPs', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let provider: any;
  let mod: MultiCollateralLiquidationModule;

  beforeEach(() => {
    program = {
      programId: PROGRAM_ID,
      account: {
        cdpPosition: {
          all: vi.fn(),
        },
        collateralVault: {
          fetch: vi.fn(),
        },
      },
      methods: {},
    };

    provider = {
      wallet: { publicKey: USER },
      connection: {},
    };

    mod = new MultiCollateralLiquidationModule(program, provider);
  });

  it('returns empty array when no positions exist', async () => {
    program.account.cdpPosition.all.mockResolvedValue([]);
    const result = await mod.fetchLiquidatableCDPs(SSS_MINT, {});
    expect(result).toHaveLength(0);
  });

  it('filters out healthy positions', async () => {
    program.account.cdpPosition.all.mockResolvedValue([
      {
        publicKey: new PublicKey('11111111111111111111111111111111'),
        account: {
          sss_mint: SSS_MINT,
          owner: USER,
          debt_amount: new BN(1_000_000), // $1 debt
          accrued_fees: new BN(0),
          collateral_mint: COLLATERAL_MINT,
        },
      },
    ]);
    // $2 collateral at $1 = 200% ratio — healthy
    program.account.collateralVault.fetch.mockResolvedValue({
      deposited_amount: new BN(2_000_000),
    });
    const result = await mod.fetchLiquidatableCDPs(SSS_MINT, {
      [COLLATERAL_MINT.toBase58()]: 1.0,
    });
    expect(result).toHaveLength(0);
  });

  it('returns undercollateralised positions', async () => {
    program.account.cdpPosition.all.mockResolvedValue([
      {
        publicKey: new PublicKey('11111111111111111111111111111111'),
        account: {
          sss_mint: SSS_MINT,
          owner: USER,
          debt_amount: new BN(1_000_000), // $1 debt
          accrued_fees: new BN(0),
          collateral_mint: COLLATERAL_MINT,
        },
      },
    ]);
    // $1.10 collateral at $1 = 110% — liquidatable (< 120%)
    program.account.collateralVault.fetch.mockResolvedValue({
      deposited_amount: new BN(1_100_000),
    });
    const result = await mod.fetchLiquidatableCDPs(SSS_MINT, {
      [COLLATERAL_MINT.toBase58()]: 1.0,
    });
    expect(result).toHaveLength(1);
    expect(result[0].isLiquidatable).toBe(true);
  });

  it('skips positions when no price feed is provided for collateral mint', async () => {
    program.account.cdpPosition.all.mockResolvedValue([
      {
        publicKey: new PublicKey('11111111111111111111111111111111'),
        account: {
          sss_mint: SSS_MINT,
          owner: USER,
          debt_amount: new BN(1_000_000),
          accrued_fees: new BN(0),
          collateral_mint: COLLATERAL_MINT,
        },
      },
    ]);
    // No price for this collateral
    const result = await mod.fetchLiquidatableCDPs(SSS_MINT, {});
    expect(result).toHaveLength(0);
  });
});

// ─── 5. Module class — property checks ───────────────────────────────────────

describe('MultiCollateralLiquidationModule class', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let provider: any;
  let mod: MultiCollateralLiquidationModule;

  beforeEach(() => {
    program = { programId: PROGRAM_ID, account: {}, methods: {} };
    provider = { wallet: { publicKey: USER }, connection: {} };
    mod = new MultiCollateralLiquidationModule(program, provider);
  });

  it('programId returns correct value', () => {
    expect(mod.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
  });

  it('cdpPositionPda matches standalone derive function', () => {
    const [expected] = deriveCdpPositionPda(SSS_MINT, USER, PROGRAM_ID);
    expect(mod.cdpPositionPda(SSS_MINT, USER).toBase58()).toBe(expected.toBase58());
  });

  it('collateralVaultPda matches standalone derive function', () => {
    const [expected] = deriveCollateralVaultPda(SSS_MINT, USER, COLLATERAL_MINT, PROGRAM_ID);
    expect(
      mod.collateralVaultPda(SSS_MINT, USER, COLLATERAL_MINT).toBase58(),
    ).toBe(expected.toBase58());
  });

  it('calcLiquidationAmount bound method works', () => {
    const result = mod.calcLiquidationAmount({
      totalDebtUnits: 500_000n,
      collateralUnits: 550_000n,
      collateralPriceUsd: 1.0,
    });
    expect(result.fullDebtToBurn).toBe(500_000n);
  });
});

// ─── 6. Constants sanity ──────────────────────────────────────────────────────

describe('Module constants', () => {
  it('LIQUIDATION_THRESHOLD_BPS is 12000 (120%)', () => {
    expect(LIQUIDATION_THRESHOLD_BPS).toBe(12_000);
  });

  it('DEFAULT_LIQUIDATION_BONUS_BPS is 500 (5%)', () => {
    expect(DEFAULT_LIQUIDATION_BONUS_BPS).toBe(500);
  });

  it('BPS_DENOMINATOR is 10000', () => {
    expect(BPS_DENOMINATOR).toBe(10_000);
  });
});
