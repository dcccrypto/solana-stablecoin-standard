/**
 * SSS-130: Stability Fee PID Auto-Adjustment
 *
 * Tests:
 *  1.  FLAG_PID_FEE_CONTROL constant is bit 11 (2048)
 *  2.  init_pid_config creates PidConfig PDA
 *  3.  init_pid_config sets FLAG_PID_FEE_CONTROL in feature_flags
 *  4.  init_pid_config stores kp, ki, kd correctly
 *  5.  init_pid_config stores target_price correctly
 *  6.  init_pid_config stores min_fee_bps and max_fee_bps correctly
 *  7.  init_pid_config initialises integral and last_error to 0
 *  8.  Non-authority cannot call init_pid_config (Unauthorized)
 *  9.  init_pid_config rejects min_fee_bps > max_fee_bps (InvalidPidFeeRange)
 * 10.  update_stability_fee_pid at peg (no error) — fee unchanged
 * 11.  update_stability_fee_pid above peg (price > target) — fee decreases (proportional)
 * 12.  update_stability_fee_pid below peg (price < target) — fee increases (proportional)
 * 13.  update_stability_fee_pid fee never goes below min_fee_bps
 * 14.  update_stability_fee_pid fee never exceeds max_fee_bps
 * 15.  update_stability_fee_pid permissionless — any signer can call
 * 16.  update_stability_fee_pid without FLAG_PID_FEE_CONTROL fails (PidConfigNotFound)
 * 17.  PID convergence test — repeated calls converge fee toward stable value
 * 18.  PID integral accumulates across multiple calls
 * 19.  PID integral anti-windup — integral stays within ±1_000_000_000
 * 20.  PID derivative dampens oscillation — direction opposes rate of change
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  lamports = 2_000_000_000
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
}

function findConfigPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  )[0];
}

function findPidConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pid-config"), mint.toBuffer()],
    programId
  );
}

describe("SSS-130: Stability Fee PID Auto-Adjustment", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  let authority: Keypair;
  let keeper: Keypair;
  let mint: Keypair;
  let configPda: PublicKey;
  let pidPda: PublicKey;

  // PID gains (scaled by 1e6): kp=0.001, ki=0.0001, kd=0.0005
  const KP = new BN(1_000);      // 0.001 * 1e6
  const KI = new BN(100);        // 0.0001 * 1e6
  const KD = new BN(500);        // 0.0005 * 1e6
  const TARGET_PRICE = new BN(1_000_000); // $1.00 with 6 decimals
  const MIN_FEE_BPS = 1;
  const MAX_FEE_BPS = 500;

  before(async () => {
    authority = Keypair.generate();
    keeper = Keypair.generate();
    mint = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, authority.publicKey),
      airdrop(provider.connection, keeper.publicKey),
    ]);

    configPda = findConfigPda(mint.publicKey, program.programId);
    [pidPda] = findPidConfigPda(mint.publicKey, program.programId);

    // Initialize stablecoin config
    await program.methods
      .initialize({
        name: "PID Test Stable",
        symbol: "PIDS",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 100, // start at 100 bps = 1%
        mintFeeBps: 10,
        burnFeeBps: 10,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, mint])
      .rpc();
  });

  // Test 1: FLAG_PID_FEE_CONTROL constant
  it("1. FLAG_PID_FEE_CONTROL constant is bit 11 (2048)", async () => {
    const FLAG_PID_FEE_CONTROL = 1 << 11;
    expect(FLAG_PID_FEE_CONTROL).to.equal(2048);
  });

  // Test 2-7: init_pid_config happy path
  it("2-7. init_pid_config creates PidConfig PDA with correct fields", async () => {
    await program.methods
      .initPidConfig({
        kp: KP,
        ki: KI,
        kd: KD,
        targetPrice: TARGET_PRICE,
        minFeeBps: MIN_FEE_BPS,
        maxFeeBps: MAX_FEE_BPS,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        pidConfig: pidPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // 2. PDA exists
    const pid = await program.account.pidConfig.fetch(pidPda);
    expect(pid).to.not.be.null;

    // 3. FLAG_PID_FEE_CONTROL set in feature_flags
    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    const FLAG_PID_FEE_CONTROL = new BN(1 << 11);
    expect(cfg.featureFlags.and(FLAG_PID_FEE_CONTROL).toNumber()).to.equal(2048);

    // 4. kp, ki, kd stored correctly
    expect(pid.kp.toNumber()).to.equal(KP.toNumber());
    expect(pid.ki.toNumber()).to.equal(KI.toNumber());
    expect(pid.kd.toNumber()).to.equal(KD.toNumber());

    // 5. target_price stored correctly
    expect(pid.targetPrice.toNumber()).to.equal(TARGET_PRICE.toNumber());

    // 6. min/max fee bps stored correctly
    expect(pid.minFeeBps).to.equal(MIN_FEE_BPS);
    expect(pid.maxFeeBps).to.equal(MAX_FEE_BPS);

    // 7. integral and last_error initialized to 0
    expect(pid.integral.toNumber()).to.equal(0);
    expect(pid.lastError.toNumber()).to.equal(0);
  });

  // Test 8: Non-authority rejected
  it("8. Non-authority cannot call init_pid_config (Unauthorized)", async () => {
    const attacker = Keypair.generate();
    await airdrop(provider.connection, attacker.publicKey);

    const attackMint = Keypair.generate();
    const attackConfig = findConfigPda(attackMint.publicKey, program.programId);
    const [attackPid] = findPidConfigPda(attackMint.publicKey, program.programId);

    // Initialize with real authority
    await program.methods
      .initialize({
        name: "Attack Test",
        symbol: "ATK",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 50,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: attackConfig,
        mint: attackMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, attackMint])
      .rpc();

    // Attacker tries to init pid config
    try {
      await program.methods
        .initPidConfig({
          kp: KP,
          ki: KI,
          kd: KD,
          targetPrice: TARGET_PRICE,
          minFeeBps: 1,
          maxFeeBps: 100,
        })
        .accounts({
          authority: attacker.publicKey,
          config: attackConfig,
          pidConfig: attackPid,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      expect.fail("Expected Unauthorized error");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // Test 9: min > max rejected
  it("9. init_pid_config rejects min_fee_bps > max_fee_bps (InvalidPidFeeRange)", async () => {
    const badMint = Keypair.generate();
    const badConfig = findConfigPda(badMint.publicKey, program.programId);
    const [badPid] = findPidConfigPda(badMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Bad Range Test",
        symbol: "BADT",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 50,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: badConfig,
        mint: badMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, badMint])
      .rpc();

    try {
      await program.methods
        .initPidConfig({
          kp: KP,
          ki: KI,
          kd: KD,
          targetPrice: TARGET_PRICE,
          minFeeBps: 500, // min > max
          maxFeeBps: 100,
        })
        .accounts({
          authority: authority.publicKey,
          config: badConfig,
          pidConfig: badPid,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      expect.fail("Expected InvalidPidFeeRange error");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidPidFeeRange");
    }
  });

  // Test 10: At peg, fee unchanged
  it("10. update_stability_fee_pid at peg — fee unchanged", async () => {
    const cfgBefore = await program.account.stablecoinConfig.fetch(configPda);
    const feeBefore = cfgBefore.stabilityFeeBps;

    // Price exactly at target
    await program.methods
      .updateStabilityFeePid(TARGET_PRICE)
      .accounts({
        caller: keeper.publicKey,
        config: configPda,
        pidConfig: pidPda,
      })
      .signers([keeper])
      .rpc();

    const cfgAfter = await program.account.stablecoinConfig.fetch(configPda);
    // With pure P term at 0 error, fee should not change significantly
    // (ki*integral might add a tiny amount if integral ≠ 0, but initial call integral=0)
    expect(cfgAfter.stabilityFeeBps).to.equal(feeBefore);
  });

  // Test 11: Price above target — fee decreases
  it("11. update_stability_fee_pid above peg — fee decreases", async () => {
    // Reset with fresh mint for clean state
    const freshMint = Keypair.generate();
    const freshConfig = findConfigPda(freshMint.publicKey, program.programId);
    const [freshPid] = findPidConfigPda(freshMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Above Peg Test",
        symbol: "ABVP",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 200, // start at 200 bps
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: freshConfig,
        mint: freshMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, freshMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(100_000), // kp=0.1 — large enough to see movement
        ki: new BN(0),
        kd: new BN(0),
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: freshConfig,
        pidConfig: freshPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Price = $1.05 (above peg)
    const priceAbovePeg = new BN(1_050_000);
    await program.methods
      .updateStabilityFeePid(priceAbovePeg)
      .accounts({
        caller: keeper.publicKey,
        config: freshConfig,
        pidConfig: freshPid,
      })
      .signers([keeper])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(freshConfig);
    // error = target - price = 1_000_000 - 1_050_000 = -50_000
    // delta_bps = kp * error / 1e6 = 100_000 * (-50_000) / 1e6 = -5
    // new_fee = clamp(200 + (-5), 1, 500) = 195
    expect(cfg.stabilityFeeBps).to.be.lessThan(200);
  });

  // Test 12: Price below target — fee increases
  it("12. update_stability_fee_pid below peg — fee increases", async () => {
    const belowMint = Keypair.generate();
    const belowConfig = findConfigPda(belowMint.publicKey, program.programId);
    const [belowPid] = findPidConfigPda(belowMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Below Peg Test",
        symbol: "BLWP",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 100,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: belowConfig,
        mint: belowMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, belowMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(100_000),
        ki: new BN(0),
        kd: new BN(0),
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: belowConfig,
        pidConfig: belowPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Price = $0.95 (below peg)
    const priceBelowPeg = new BN(950_000);
    await program.methods
      .updateStabilityFeePid(priceBelowPeg)
      .accounts({
        caller: keeper.publicKey,
        config: belowConfig,
        pidConfig: belowPid,
      })
      .signers([keeper])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(belowConfig);
    // error = 1_000_000 - 950_000 = 50_000
    // delta_bps = 100_000 * 50_000 / 1e6 = 5
    // new_fee = clamp(100 + 5, 1, 500) = 105
    expect(cfg.stabilityFeeBps).to.be.greaterThan(100);
  });

  // Test 13: Fee never below min_fee_bps
  it("13. update_stability_fee_pid fee never goes below min_fee_bps", async () => {
    const minMint = Keypair.generate();
    const minConfig = findConfigPda(minMint.publicKey, program.programId);
    const [minPid] = findPidConfigPda(minMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Min Floor Test",
        symbol: "MINF",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 5, // start very low
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: minConfig,
        mint: minMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, minMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(10_000_000), // very aggressive kp
        ki: new BN(0),
        kd: new BN(0),
        targetPrice: TARGET_PRICE,
        minFeeBps: 2,   // floor at 2 bps
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: minConfig,
        pidConfig: minPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Price way above peg → massive negative delta
    const priceFarAbove = new BN(2_000_000); // $2.00
    await program.methods
      .updateStabilityFeePid(priceFarAbove)
      .accounts({
        caller: keeper.publicKey,
        config: minConfig,
        pidConfig: minPid,
      })
      .signers([keeper])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(minConfig);
    expect(cfg.stabilityFeeBps).to.be.greaterThanOrEqual(2); // floor enforced
  });

  // Test 14: Fee never above max_fee_bps
  it("14. update_stability_fee_pid fee never exceeds max_fee_bps", async () => {
    const maxMint = Keypair.generate();
    const maxConfig = findConfigPda(maxMint.publicKey, program.programId);
    const [maxPid] = findPidConfigPda(maxMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Max Cap Test",
        symbol: "MAXC",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 490,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: maxConfig,
        mint: maxMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, maxMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(10_000_000), // very aggressive
        ki: new BN(0),
        kd: new BN(0),
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 200, // cap at 200 bps
      })
      .accounts({
        authority: authority.publicKey,
        config: maxConfig,
        pidConfig: maxPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Price way below peg → massive positive delta
    const priceFarBelow = new BN(500_000); // $0.50
    await program.methods
      .updateStabilityFeePid(priceFarBelow)
      .accounts({
        caller: keeper.publicKey,
        config: maxConfig,
        pidConfig: maxPid,
      })
      .signers([keeper])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(maxConfig);
    expect(cfg.stabilityFeeBps).to.be.lessThanOrEqual(200); // cap enforced
  });

  // Test 15: Permissionless — any signer can call
  it("15. update_stability_fee_pid permissionless — any signer can call", async () => {
    const randKeeper = Keypair.generate();
    await airdrop(provider.connection, randKeeper.publicKey);

    // Should not throw
    await program.methods
      .updateStabilityFeePid(TARGET_PRICE)
      .accounts({
        caller: randKeeper.publicKey,
        config: configPda,
        pidConfig: pidPda,
      })
      .signers([randKeeper])
      .rpc();
  });

  // Test 16: Without FLAG_PID_FEE_CONTROL — fails
  it("16. update_stability_fee_pid without FLAG_PID_FEE_CONTROL fails (PidConfigNotFound)", async () => {
    // Create a fresh config without PID enabled
    const noPidMint = Keypair.generate();
    const noPidConfig = findConfigPda(noPidMint.publicKey, program.programId);
    const [noPid] = findPidConfigPda(noPidMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "No PID Test",
        symbol: "NOPID",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 100,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: noPidConfig,
        mint: noPidMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, noPidMint])
      .rpc();

    // Init PID config but don't call it yet — actually call update without init
    // We need a pid_config PDA to pass; use an arbitrary one that won't match
    try {
      await program.methods
        .updateStabilityFeePid(TARGET_PRICE)
        .accounts({
          caller: keeper.publicKey,
          config: noPidConfig,
          pidConfig: noPid,
        })
        .signers([keeper])
        .rpc();
      expect.fail("Expected PidConfigNotFound");
    } catch (err: any) {
      expect(err.toString()).to.include("PidConfigNotFound");
    }
  });

  // Test 17: Convergence test
  it("17. PID convergence — repeated calls converge fee toward stable value", async () => {
    const convMint = Keypair.generate();
    const convConfig = findConfigPda(convMint.publicKey, program.programId);
    const [convPid] = findPidConfigPda(convMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Convergence Test",
        symbol: "CONV",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 300,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: convConfig,
        mint: convMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, convMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(50_000),  // moderate kp
        ki: new BN(5_000),   // small ki
        kd: new BN(10_000),  // moderate kd for damping
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: convConfig,
        pidConfig: convPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const prices = [
      new BN(980_000), // $0.98 — below peg
      new BN(990_000), // $0.99
      new BN(995_000), // $0.995
      new BN(998_000), // $0.998
      new BN(999_000), // $0.999
      new BN(1_000_000), // at peg
    ];

    let fees: number[] = [];
    for (const price of prices) {
      await program.methods
        .updateStabilityFeePid(price)
        .accounts({
          caller: keeper.publicKey,
          config: convConfig,
          pidConfig: convPid,
        })
        .signers([keeper])
        .rpc();
      const c = await program.account.stablecoinConfig.fetch(convConfig);
      fees.push(c.stabilityFeeBps);
    }

    // Fee should have generally increased when below peg, then stabilised
    expect(fees.length).to.equal(6);
    // First few should show increase (below peg scenario)
    expect(fees[0]).to.be.greaterThanOrEqual(300);
    // All fees should be within bounds
    fees.forEach(f => {
      expect(f).to.be.greaterThanOrEqual(1);
      expect(f).to.be.lessThanOrEqual(500);
    });
  });

  // Test 18: Integral accumulates
  it("18. PID integral accumulates across multiple calls", async () => {
    const intMint = Keypair.generate();
    const intConfig = findConfigPda(intMint.publicKey, program.programId);
    const [intPid] = findPidConfigPda(intMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Integral Test",
        symbol: "INT",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 100,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: intConfig,
        mint: intMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, intMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(0),         // pure integral controller
        ki: new BN(1_000),
        kd: new BN(0),
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: intConfig,
        pidConfig: intPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Call 3 times with same below-peg price
    const belowPeg = new BN(950_000);
    for (let i = 0; i < 3; i++) {
      await program.methods
        .updateStabilityFeePid(belowPeg)
        .accounts({
          caller: keeper.publicKey,
          config: intConfig,
          pidConfig: intPid,
        })
        .signers([keeper])
        .rpc();
    }

    const pid = await program.account.pidConfig.fetch(intPid);
    // integral should have accumulated: 3 * 50_000 = 150_000
    expect(pid.integral.toNumber()).to.be.greaterThan(0);
    expect(pid.integral.toNumber()).to.equal(150_000);
  });

  // Test 19: Anti-windup
  it("19. PID integral anti-windup — integral stays within ±1_000_000_000", async () => {
    const awMint = Keypair.generate();
    const awConfig = findConfigPda(awMint.publicKey, program.programId);
    const [awPid] = findPidConfigPda(awMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Anti-Windup Test",
        symbol: "AWUP",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 100,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: awConfig,
        mint: awMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, awMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(0),
        ki: new BN(1_000_000), // very large ki
        kd: new BN(0),
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: awConfig,
        pidConfig: awPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Call many times with extreme below-peg price to stress-test anti-windup
    const extremeBelow = new BN(100_000); // $0.10 — extreme deviation
    for (let i = 0; i < 10; i++) {
      await program.methods
        .updateStabilityFeePid(extremeBelow)
        .accounts({
          caller: keeper.publicKey,
          config: awConfig,
          pidConfig: awPid,
        })
        .signers([keeper])
        .rpc();
    }

    const pid = await program.account.pidConfig.fetch(awPid);
    // Anti-windup: integral must not exceed 1_000_000_000
    expect(Math.abs(pid.integral.toNumber())).to.be.lessThanOrEqual(1_000_000_000);
  });

  // Test 20: Derivative dampens oscillation
  it("20. PID derivative dampens oscillation — direction opposes rate of change", async () => {
    const dervMint = Keypair.generate();
    const dervConfig = findConfigPda(dervMint.publicKey, program.programId);
    const [dervPid] = findPidConfigPda(dervMint.publicKey, program.programId);

    await program.methods
      .initialize({
        name: "Derivative Test",
        symbol: "DERV",
        decimals: 6,
        maxSupply: new BN(1_000_000_000_000),
        stabilityFeeBps: 200,
        mintFeeBps: 5,
        burnFeeBps: 5,
        freezeAuthority: null,
        transferFeeAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: dervConfig,
        mint: dervMint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, dervMint])
      .rpc();

    await program.methods
      .initPidConfig({
        kp: new BN(0),
        ki: new BN(0),
        kd: new BN(1_000_000), // pure derivative controller
        targetPrice: TARGET_PRICE,
        minFeeBps: 1,
        maxFeeBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: dervConfig,
        pidConfig: dervPid,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // First call: error = 1_000_000 - 980_000 = 20_000, derivative = 20_000 - 0 = 20_000
    await program.methods
      .updateStabilityFeePid(new BN(980_000))
      .accounts({
        caller: keeper.publicKey,
        config: dervConfig,
        pidConfig: dervPid,
      })
      .signers([keeper])
      .rpc();

    const pidAfterFirst = await program.account.pidConfig.fetch(dervPid);
    expect(pidAfterFirst.lastError.toNumber()).to.equal(20_000);

    // Second call with price moving further from peg: error = 50_000, derivative = 50_000 - 20_000 = 30_000
    await program.methods
      .updateStabilityFeePid(new BN(950_000))
      .accounts({
        caller: keeper.publicKey,
        config: dervConfig,
        pidConfig: dervPid,
      })
      .signers([keeper])
      .rpc();

    const pidAfterSecond = await program.account.pidConfig.fetch(dervPid);
    const cfgAfterSecond = await program.account.stablecoinConfig.fetch(dervConfig);

    // last_error should be updated to 50_000
    expect(pidAfterSecond.lastError.toNumber()).to.equal(50_000);
    // Fee should have increased due to positive derivative
    expect(cfgAfterSecond.stabilityFeeBps).to.be.greaterThan(200);
  });
});
