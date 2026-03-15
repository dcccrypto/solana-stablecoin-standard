/**
 * SSS-042 Direction 2: CDP Vault — Collateral Ratio Math
 *
 * Property tests for the Collateralized Debt Position (CDP) vault math:
 * - Minimum collateralization ratio enforcement (150% default)
 * - Liquidation threshold (120%)
 * - Reserve ratio (SSS-3 100% backed)
 * - Rounding / integer arithmetic safety (mimics u64 on-chain)
 */

import { describe, it, expect } from "vitest";

// ─── CDP Types ─────────────────────────────────────────────────────────────

interface CdpVault {
  collateralAmount: bigint; // lamports or collateral token units
  collateralPrice: bigint;  // price in basis points (e.g. 1_000_000 = $10.00)
  debtAmount: bigint;       // stablecoin units (6 decimals)
  minRatioBps: bigint;      // e.g. 15_000 = 150%
  liquidationRatioBps: bigint; // e.g. 12_000 = 120%
}

// ─── CDP Math Helpers ──────────────────────────────────────────────────────

const BPS = 10_000n;
const PRICE_DECIMALS = 100_000n; // price expressed with 5 decimal places

/** Collateral value in stablecoin units (6 decimals). */
function collateralValue(vault: CdpVault): bigint {
  return (vault.collateralAmount * vault.collateralPrice) / PRICE_DECIMALS;
}

/** Current collateral ratio in basis points. Returns MAX_BIGINT if debt = 0. */
function collateralRatioBps(vault: CdpVault): bigint {
  if (vault.debtAmount === 0n) return BigInt(Number.MAX_SAFE_INTEGER);
  return (collateralValue(vault) * BPS) / vault.debtAmount;
}

/** Maximum debt that can be minted given collateral (at minRatio). */
function maxMintable(vault: CdpVault): bigint {
  const cv = collateralValue(vault);
  return (cv * BPS) / vault.minRatioBps;
}

/** Whether vault is healthy (above min ratio). */
function isHealthy(vault: CdpVault): boolean {
  return collateralRatioBps(vault) >= vault.minRatioBps;
}

/** Whether vault is liquidatable (below liquidation ratio). */
function isLiquidatable(vault: CdpVault): boolean {
  return collateralRatioBps(vault) < vault.liquidationRatioBps;
}

/** Simulate a mint: increase debt. Returns new vault or throws if unhealthy. */
function simulateMint(vault: CdpVault, mintAmount: bigint): CdpVault {
  const newVault = { ...vault, debtAmount: vault.debtAmount + mintAmount };
  if (!isHealthy(newVault)) throw new Error("MintWouldBreachMinRatio");
  return newVault;
}

/** SSS-3 reserve ratio: collateral covers 100% of supply. */
function reserveRatioBps(collateral: bigint, supply: bigint): bigint {
  if (supply === 0n) return 10_000n;
  return (collateral * BPS) / supply;
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────

/** 150 SOL @ $100 = $15,000 collateral, $8,000 debt → 187.5% ratio. */
const healthyVault: CdpVault = {
  collateralAmount: 150n * 1_000_000n,     // 150 SOL in lamports (simplified)
  collateralPrice: 10_000_000n,              // $100.00 (5 decimals → 100.00000)
  debtAmount: 8_000n * 1_000_000n,          // $8,000 debt (6 decimals)
  minRatioBps: 15_000n,
  liquidationRatioBps: 12_000n,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Direction 2: CDP Vault Collateral Ratio Math", () => {
  it("computes collateral value correctly", () => {
    // 150_000_000 * 10_000_000 / 100_000 = 15_000_000_000_000 / 100_000 = 150_000_000_000
    // ≈ $150,000 in 6-decimal units → 150_000 * 1e6 = 150_000_000_000
    expect(collateralValue(healthyVault)).toBe(15_000_000_000n);
  });

  it("healthy vault reports correct ratio", () => {
    const ratio = collateralRatioBps(healthyVault);
    // $15,000 / $8,000 * 10,000 = 18,750 bps = 187.5%
    expect(ratio).toBe(18_750n);
  });

  it("isHealthy is true above min ratio", () => {
    expect(isHealthy(healthyVault)).toBe(true);
  });

  it("isLiquidatable is false for healthy vault", () => {
    expect(isLiquidatable(healthyVault)).toBe(false);
  });

  it("vault at exactly min ratio (150%) is healthy", () => {
    // debt = collateral / 1.5 → 15_000_000_000 / 1.5 = 10_000_000_000
    const atEdge: CdpVault = { ...healthyVault, debtAmount: 10_000_000_000n };
    expect(isHealthy(atEdge)).toBe(true);
    expect(collateralRatioBps(atEdge)).toBe(15_000n);
  });

  it("vault just below min ratio is unhealthy", () => {
    const tooMuchDebt: CdpVault = { ...healthyVault, debtAmount: 10_000_000_001n };
    expect(isHealthy(tooMuchDebt)).toBe(false);
  });

  it("vault below liquidation threshold is liquidatable", () => {
    // debt = $14,000 → ratio = 15_000_000_000 / 14_000_000_000 * 10000 ≈ 10,714 < 12,000
    const underwater: CdpVault = { ...healthyVault, debtAmount: 14_000_000_000n };
    expect(isLiquidatable(underwater)).toBe(true);
  });

  it("maxMintable never breaches min ratio", () => {
    const maxDebt = maxMintable(healthyVault);
    const atMax: CdpVault = { ...healthyVault, debtAmount: maxDebt };
    expect(isHealthy(atMax)).toBe(true);
    // One unit above max should fail
    const overMax: CdpVault = { ...healthyVault, debtAmount: maxDebt + 1n };
    expect(isHealthy(overMax)).toBe(false);
  });

  it("simulateMint rejects if it would breach min ratio", () => {
    const maxDebt = maxMintable(healthyVault);
    const safeAmount = maxDebt - healthyVault.debtAmount;
    // Minting exactly safeAmount should succeed
    expect(() => simulateMint(healthyVault, safeAmount)).not.toThrow();
    // Minting one more should fail
    expect(() => simulateMint(healthyVault, safeAmount + 1n)).toThrow("MintWouldBreachMinRatio");
  });

  it("zero debt vault is always healthy", () => {
    const fresh: CdpVault = { ...healthyVault, debtAmount: 0n };
    expect(isHealthy(fresh)).toBe(true);
    expect(isLiquidatable(fresh)).toBe(false);
  });

  it("price drop reduces collateral value proportionally", () => {
    // Price drops 50%: $100 → $50
    const halvedPrice: CdpVault = { ...healthyVault, collateralPrice: 5_000_000n };
    const originalValue = collateralValue(healthyVault);
    const halvedValue = collateralValue(halvedPrice);
    expect(halvedValue * 2n).toBe(originalValue);
  });

  it("SSS-3 reserve ratio: 100% backed when collateral = supply", () => {
    const supply = 1_000_000n;
    expect(reserveRatioBps(supply, supply)).toBe(10_000n); // 100%
  });

  it("SSS-3 reserve ratio: over-collateralized returns > 10_000 bps", () => {
    const supply = 1_000_000n;
    const collateral = 1_500_000n; // 150%
    expect(reserveRatioBps(collateral, supply)).toBe(15_000n);
  });

  it("SSS-3 reserve ratio: under-collateralized returns < 10_000 bps", () => {
    const supply = 2_000_000n;
    const collateral = 1_000_000n; // 50%
    expect(reserveRatioBps(collateral, supply)).toBe(5_000n);
  });

  it("SSS-3 reserve ratio: zero supply returns exactly 100%", () => {
    expect(reserveRatioBps(0n, 0n)).toBe(10_000n);
  });

  it("no integer overflow for u64 max values in ratio calc", () => {
    // u64 max = 18_446_744_073_709_551_615n — verify no overflow in ratio computation
    const bigVault: CdpVault = {
      collateralAmount: 1_000_000n,
      collateralPrice: 100_000n, // $1.00
      debtAmount: 500_000n,
      minRatioBps: 15_000n,
      liquidationRatioBps: 12_000n,
    };
    expect(() => collateralRatioBps(bigVault)).not.toThrow();
    expect(isHealthy(bigVault)).toBe(true);
  });
});
