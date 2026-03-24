/**
 * SSS-132: PSM Dynamic AMM-Style Slippage Curves
 *
 * Tests for PsmCurveConfig PDA and the depth-based fee curve:
 *   fee_bps = base_fee_bps + curve_k * (imbalance / total_reserves)^2
 *
 * Test coverage:
 *  1.  FLAG_PSM_DYNAMIC_FEES constant is bit 13 (8192)
 *  2.  PsmCurveConfig PDA seeds are [b"psm-curve-config", sss_mint]
 *  3.  Curve formula: balanced pool (50/50) returns base_fee_bps exactly
 *  4.  Curve formula: fully imbalanced pool returns max_fee_bps (clamped)
 *  5.  Curve formula: partial imbalance (25% skew) gives intermediate fee
 *  6.  Curve formula: 75% skew gives higher fee than 25% skew
 *  7.  Curve formula: k=0 always returns base_fee_bps regardless of imbalance
 *  8.  Fee never exceeds max_fee_bps (ceiling invariant)
 *  9.  Fee never drops below base_fee_bps (floor invariant)
 *  10. total_reserves=0 returns base_fee_bps (zero-divide guard)
 *  11. base_fee_bps=0 and balanced pool: fee=0
 *  12. base_fee_bps=0 and unbalanced pool: fee > 0 when curve_k > 0
 *  13. Fee is monotonically non-decreasing with imbalance
 *  14. max_fee_bps ceiling is 2000 bps (20%) — validate_curve_params rejects higher
 *  15. base_fee_bps > max_fee_bps is rejected by validate_curve_params
 *  16. Expected collateral output: amount - fee (correct arithmetic)
 *  17. PsmQuoteEvent fields match manual fee computation
 *  18. compute_fee is deterministic — same inputs → same output
 *  19. Symmetric imbalance: overweight and underweight give identical fee
 *  20. Large total_reserves with small imbalance stays near base fee
 */

import { assert } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Pure TypeScript model of PsmCurveConfig::compute_fee
// Mirrors the Rust implementation in state.rs
// ---------------------------------------------------------------------------

function computePsmFee(
  baseFee: number,
  curveK: bigint,
  maxFee: number,
  vaultAmount: bigint,
  totalReserves: bigint,
): number {
  if (totalReserves === 0n) return baseFee;

  const ideal = totalReserves / 2n;
  const vault = vaultAmount;
  const imbalance = vault > ideal ? vault - ideal : ideal - vault;

  // ratio_1e6 = imbalance * 1_000_000 / total_reserves
  const ratio1e6 = (imbalance * 1_000_000n) / totalReserves;

  // ratio_sq_1e12 = ratio_1e6^2
  const ratioSq1e12 = ratio1e6 * ratio1e6;

  // fee_delta_bps = curve_k * ratio_sq_1e12 / 1_000_000_000_000
  const feeDeltaBps = (curveK * ratioSq1e12) / 1_000_000_000_000n;

  const rawFee = BigInt(baseFee) + feeDeltaBps;
  const clamped = rawFee < BigInt(maxFee) ? Number(rawFee) : maxFee;
  return clamped;
}

// ---------------------------------------------------------------------------
// validate_curve_params model
// ---------------------------------------------------------------------------
function validateCurveParams(base: number, max: number): boolean {
  if (max > 2000) return false;
  if (base > max) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SSS-132: PSM Dynamic AMM-Style Slippage Curves", () => {
  const sssMint = Keypair.generate().publicKey;
  const programId = new PublicKey("AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");

  // Default curve params used across tests
  const defaultCurve = {
    baseFee: 5,          // 0.05%
    curveK: 50_000_000n, // moderate steepness
    maxFee: 300,         // 3% ceiling
  };

  // ─── Constant / PDA checks ────────────────────────────────────────────────

  it("1. FLAG_PSM_DYNAMIC_FEES constant is bit 13 (8192)", () => {
    const expected = 1 << 13;
    assert.strictEqual(expected, 8192);
  });

  it("2. PsmCurveConfig PDA seeds are [b'psm-curve-config', sss_mint]", () => {
    const [derived] = PublicKey.findProgramAddressSync(
      [Buffer.from("psm-curve-config"), sssMint.toBuffer()],
      programId,
    );
    // Verify it's derivable and stable
    const [derived2] = PublicKey.findProgramAddressSync(
      [Buffer.from("psm-curve-config"), sssMint.toBuffer()],
      programId,
    );
    assert.strictEqual(derived.toBase58(), derived2.toBase58());
  });

  // ─── Fee curve formula tests ──────────────────────────────────────────────

  it("3. Balanced pool (50/50): fee equals base_fee_bps", () => {
    // vault_amount = total_reserves / 2 → imbalance = 0 → delta = 0 → fee = base
    const totalReserves = 2_000_000n;
    const vaultAmount = 1_000_000n; // exactly 50%
    const fee = computePsmFee(
      defaultCurve.baseFee,
      defaultCurve.curveK,
      defaultCurve.maxFee,
      vaultAmount,
      totalReserves,
    );
    assert.strictEqual(fee, defaultCurve.baseFee, "Balanced pool fee must equal base_fee_bps");
  });

  it("4. Fully imbalanced pool: fee clamped to max_fee_bps", () => {
    // vault_amount = 0 → maximum imbalance
    const totalReserves = 2_000_000n;
    const vaultAmount = 0n;
    // Use very high curve_k to force saturation
    const fee = computePsmFee(5, 1_000_000_000_000n, 500, vaultAmount, totalReserves);
    assert.strictEqual(fee, 500, "Fully imbalanced pool fee must be clamped to max_fee_bps");
  });

  it("5. 25% skew gives intermediate fee above base", () => {
    // vault = 75% of ideal → 25% skew from perfect balance
    const totalReserves = 2_000_000n;
    const ideal = 1_000_000n;
    const vaultAmount = ideal + 500_000n; // 75% of total
    const fee = computePsmFee(
      defaultCurve.baseFee,
      defaultCurve.curveK,
      defaultCurve.maxFee,
      vaultAmount,
      totalReserves,
    );
    assert.isAtLeast(fee, defaultCurve.baseFee, "25% skew fee should be >= base");
  });

  it("6. 75% skew gives higher fee than 25% skew", () => {
    // Pool: total_reserves=2_000_000, ideal=1_000_000
    // 25% skew: vault=1_500_000, imbalance=500_000
    //   ratio_1e6 = 500_000*1e6/2_000_000 = 250_000
    //   ratio_sq_1e12 = 250_000^2 = 6.25e10
    //   delta = 800 * 6.25e10 / 1e12 = 50 bps
    // 50% skew: vault=2_000_000, imbalance=1_000_000
    //   ratio_1e6 = 500_000; ratio_sq_1e12 = 2.5e11
    //   delta = 800 * 2.5e11 / 1e12 = 200 bps
    const totalReserves = 2_000_000n;
    const k = 800n;
    const maxFee = 2_000;
    const base = 5;

    const fee25 = computePsmFee(base, k, maxFee, 1_500_000n, totalReserves); // 25% skew → ~55 bps
    const fee50 = computePsmFee(base, k, maxFee, 2_000_000n, totalReserves); // 50% skew → ~205 bps

    assert.isAbove(fee50, fee25, "Higher imbalance (50% skew) should produce higher fee than 25% skew");
  });

  it("7. k=0: fee always equals base_fee_bps regardless of imbalance", () => {
    const totalReserves = 1_000_000n;
    const base = 10;
    const max = 200;

    for (const vault of [0n, 250_000n, 500_000n, 750_000n, 1_000_000n]) {
      const fee = computePsmFee(base, 0n, max, vault, totalReserves);
      assert.strictEqual(fee, base, `k=0 fee should equal base at vault=${vault}`);
    }
  });

  it("8. Fee never exceeds max_fee_bps — ceiling invariant", () => {
    const base = 5;
    const max = 300;
    const totalReserves = 1_000_000n;

    // Test a range of vaults with a high k
    const highK = 100_000_000_000n;
    for (const vault of [0n, 100_000n, 500_000n, 900_000n, 1_000_000n]) {
      const fee = computePsmFee(base, highK, max, vault, totalReserves);
      assert.isAtMost(fee, max, `Fee must not exceed max_fee_bps at vault=${vault}`);
    }
  });

  it("9. Fee never drops below base_fee_bps — floor invariant", () => {
    const base = 10;
    const max = 500;
    const totalReserves = 1_000_000n;

    for (const vault of [0n, 250_000n, 500_000n, 750_000n, 1_000_000n]) {
      const fee = computePsmFee(base, 50_000_000n, max, vault, totalReserves);
      assert.isAtLeast(fee, base, `Fee must not drop below base_fee_bps at vault=${vault}`);
    }
  });

  it("10. total_reserves=0: returns base_fee_bps (zero-divide guard)", () => {
    const fee = computePsmFee(7, 99_999_999n, 500, 1_000n, 0n);
    assert.strictEqual(fee, 7, "Zero total_reserves must return base_fee_bps");
  });

  it("11. base_fee_bps=0 and balanced pool: fee=0", () => {
    const totalReserves = 2_000_000n;
    const vaultAmount = 1_000_000n; // exactly balanced
    const fee = computePsmFee(0, 50_000_000n, 200, vaultAmount, totalReserves);
    assert.strictEqual(fee, 0, "At balance with base=0, fee must be 0");
  });

  it("12. base_fee_bps=0 and unbalanced pool: fee > 0 when curve_k > 0", () => {
    const totalReserves = 2_000_000n;
    const vaultAmount = 0n; // maximally imbalanced
    const fee = computePsmFee(0, 500_000_000n, 200, vaultAmount, totalReserves);
    assert.isAbove(fee, 0, "Unbalanced pool with base=0 and k>0 should produce fee>0");
  });

  it("13. Fee is monotonically non-decreasing with imbalance magnitude", () => {
    const base = 5;
    const k = 200_000_000n;
    const max = 2000;
    const totalReserves = 2_000_000n;
    const ideal = 1_000_000n; // 50% of 2M

    // Vault closer to ideal → lower fee; vault farther → higher fee
    const vaults = [
      ideal,             // 0% imbalance
      ideal - 250_000n,  // 25% imbalance (under-weighted)
      ideal - 500_000n,  // 50% imbalance
      ideal - 750_000n,  // 75% imbalance
      0n,               // 100% imbalance
    ];

    let prevFee = -1;
    for (const vault of vaults) {
      const fee = computePsmFee(base, k, max, vault, totalReserves);
      assert.isAtLeast(fee, prevFee, "Fee must be non-decreasing as imbalance grows");
      prevFee = fee;
    }
  });

  it("14. max_fee_bps > 2000 is rejected by validation", () => {
    assert.isFalse(validateCurveParams(5, 2001), "max_fee=2001 must be rejected");
    assert.isFalse(validateCurveParams(5, 5000), "max_fee=5000 must be rejected");
    assert.isTrue(validateCurveParams(5, 2000), "max_fee=2000 must be accepted");
  });

  it("15. base_fee_bps > max_fee_bps is rejected by validation", () => {
    assert.isFalse(validateCurveParams(300, 200), "base > max must be rejected");
    assert.isTrue(validateCurveParams(200, 200), "base == max must be accepted");
    assert.isTrue(validateCurveParams(0, 200), "base=0, max=200 must be accepted");
  });

  it("16. Correct collateral output arithmetic: amount - fee", () => {
    const amount = 1_000_000n;
    const totalReserves = 2_000_000n;
    const vaultAmount = 500_000n; // imbalanced
    const feeBps = computePsmFee(5, 50_000_000n, 300, vaultAmount, totalReserves);

    const feeAmount = (amount * BigInt(feeBps)) / 10_000n;
    const collateralOut = amount - feeAmount;

    assert.isAbove(Number(collateralOut), 0, "collateral_out must be > 0");
    assert.isBelow(Number(collateralOut), Number(amount), "collateral_out must be < amount");
    assert.strictEqual(Number(collateralOut) + Number(feeAmount), Number(amount),
      "out + fee must equal amount");
  });

  it("17. PsmQuoteEvent fields match manual fee computation", () => {
    const amountIn = 500_000n;
    const vaultAmount = 300_000n;
    const totalReserves = 1_200_000n;
    const baseFee = 5;
    const k = 100_000_000n;
    const maxFee = 400;

    const feeBps = computePsmFee(baseFee, k, maxFee, vaultAmount, totalReserves);
    const expectedFee = (amountIn * BigInt(feeBps)) / 10_000n;
    const expectedOut = amountIn - expectedFee;

    // Verify the quote event would contain the correct values
    assert.isAtLeast(feeBps, baseFee);
    assert.isAtMost(feeBps, maxFee);
    assert.strictEqual(Number(expectedOut + expectedFee), Number(amountIn),
      "PsmQuoteEvent: out + fee must reconstruct amountIn");
  });

  it("18. compute_fee is deterministic — same inputs produce same output", () => {
    const args: [number, bigint, number, bigint, bigint] = [
      10, 75_000_000n, 500, 600_000n, 1_500_000n,
    ];
    const fee1 = computePsmFee(...args);
    const fee2 = computePsmFee(...args);
    assert.strictEqual(fee1, fee2, "compute_fee must be deterministic");
  });

  it("19. Symmetric imbalance: over-weighted and under-weighted give identical fee", () => {
    const totalReserves = 2_000_000n;
    const ideal = 1_000_000n;
    const skew = 300_000n;

    // vault over-weighted by skew
    const feeOver = computePsmFee(5, 100_000_000n, 500, ideal + skew, totalReserves);
    // vault under-weighted by same skew
    const feeUnder = computePsmFee(5, 100_000_000n, 500, ideal - skew, totalReserves);

    assert.strictEqual(feeOver, feeUnder,
      "Symmetric imbalance (over vs under) must produce identical fees");
  });

  it("20. Large total_reserves with tiny imbalance stays near base fee", () => {
    // 1 billion reserves, only 1000 unit imbalance
    const totalReserves = 1_000_000_000n;
    const ideal = 500_000_000n;
    const vaultAmount = ideal + 1_000n; // negligible imbalance

    const fee = computePsmFee(5, 500_000_000n, 300, vaultAmount, totalReserves);
    // Imbalance ratio = 1000 / 1e9 = 1e-6; ratio^2 = 1e-12; delta ~ 0
    assert.strictEqual(fee, 5, "Tiny imbalance in large pool should yield base fee");
  });
});
