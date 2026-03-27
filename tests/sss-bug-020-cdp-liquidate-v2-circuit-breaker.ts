/**
 * BUG-020 Tests: cdp_liquidate_v2 must check FLAG_CIRCUIT_BREAKER
 *
 * Verifies:
 * 1. cdp_liquidate_v2 rejects with CircuitBreakerActive when flag is set
 * 2. cdp_liquidate_v2 proceeds normally when flag is cleared
 * 3. Circuit breaker flag set mid-flight: V2 call after flag set → rejected
 * 4. Both debt_to_repay=0 (full) and debt_to_repay>0 (partial) are blocked
 * 5. V1 cdp_liquidate is also blocked when flag is set (regression check)
 * 6. Non-authority cannot clear circuit breaker
 * 7. Authority can toggle circuit breaker repeatedly
 * 8. V2 blocked when circuit breaker set via DAO governance path (simulate flag)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";

// FLAG_CIRCUIT_BREAKER = 1 << 0
const FLAG_CIRCUIT_BREAKER = new anchor.BN(1);

describe("BUG-020: cdp_liquidate_v2 must respect FLAG_CIRCUIT_BREAKER", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = provider.wallet as anchor.Wallet;

  const bug020Mint = Keypair.generate();
  const collateralMint = Keypair.generate();
  const cdpOwnerKp = Keypair.generate();
  let configPda: PublicKey;
  let liquidatorSssAta: PublicKey;
  let cdpPositionPda: PublicKey;
  let collateralVaultPda: PublicKey;
  let collateralOwnerAtaAddr: PublicKey;

  before(async () => {
    // Fund authority and cdpOwner
    const bal = await provider.connection.getBalance(authority.publicKey);
    if (bal < 10 * LAMPORTS_PER_SOL) {
      const sig = await provider.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
    const sigO = await provider.connection.requestAirdrop(cdpOwnerKp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sigO);

    // Derive config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), bug020Mint.publicKey.toBuffer()],
      program.programId
    );

    // Initialize with SSS-3 preset
    await program.methods
      .initialize({
        preset: 3,
        decimals: 6,
        name: "BUG020 Test USD",
        symbol: "B20U",
        uri: "https://test.invalid",
        transferHookProgram: null,
        collateralMint: collateralMint.publicKey,
        maxSupply: new anchor.BN(1_000_000_000),
        adminTimelockDelay: new anchor.BN(0),
          squadsMultisig: Keypair.generate().publicKey,
      })
      .accounts({
        authority: authority.publicKey,
        mint: bug020Mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bug020Mint])
      .rpc();

    liquidatorSssAta = getAssociatedTokenAddressSync(
      bug020Mint.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    [cdpPositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("cdp-position"), bug020Mint.publicKey.toBuffer(), cdpOwnerKp.publicKey.toBuffer()],
      program.programId
    );

    [collateralVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral-vault"), bug020Mint.publicKey.toBuffer(), collateralMint.publicKey.toBuffer()],
      program.programId
    );

    collateralOwnerAtaAddr = getAssociatedTokenAddressSync(
      collateralMint.publicKey,
      cdpOwnerKp.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function setCircuitBreaker() {
    await program.methods
      .setFeatureFlag(FLAG_CIRCUIT_BREAKER)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: bug020Mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  async function clearCircuitBreaker() {
    await program.methods
      .clearFeatureFlag(FLAG_CIRCUIT_BREAKER)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: bug020Mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  async function attemptV2Liquidation(debtToRepay: anchor.BN, minCollateral: anchor.BN): Promise<string> {
    try {
      await program.methods
        .cdpLiquidateV2(debtToRepay, minCollateral)
        .accounts({
          liquidator: authority.publicKey,
          config: configPda,
          sssMint: bug020Mint.publicKey,
          liquidatorSssAccount: liquidatorSssAta,
          cdpPosition: cdpPositionPda,
          cdpOwner: cdpOwnerKp.publicKey,
          collateralMint: collateralMint.publicKey,
          collateralVault: collateralVaultPda,
          collateralOwnerAta: collateralOwnerAtaAddr,
          pythPriceFeed: PublicKey.default,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      return "success";
    } catch (err: any) {
      return err.message || err.toString();
    }
  }

  // ── Test 1: V2 rejects when circuit breaker set (debt_to_repay=0 / full) ─
  it("BUG-020-01: cdp_liquidate_v2 rejects with CircuitBreakerActive when flag is set (full liquidation)", async () => {
    await setCircuitBreaker();
    const result = await attemptV2Liquidation(new anchor.BN(0), new anchor.BN(0));
    expect(result).to.match(/CircuitBreakerActive/);
  });

  // ── Test 2: V2 rejects when circuit breaker set (debt_to_repay>0 / partial) ─
  it("BUG-020-02: cdp_liquidate_v2 rejects with CircuitBreakerActive (partial liquidation path)", async () => {
    // Circuit breaker still set from test 1
    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.featureFlags.toNumber() & 1).to.equal(1, "FLAG_CIRCUIT_BREAKER should be set");

    const result = await attemptV2Liquidation(new anchor.BN(500_000), new anchor.BN(0));
    expect(result).to.match(/CircuitBreakerActive/);
  });

  // ── Test 3: V2 unblocked after circuit breaker cleared ───────────────────
  it("BUG-020-03: cdp_liquidate_v2 passes CircuitBreakerActive check after flag is cleared", async () => {
    await clearCircuitBreaker();
    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.featureFlags.toNumber() & 1).to.equal(0, "FLAG_CIRCUIT_BREAKER should be cleared");

    // Attempt liquidation — will fail later (no CDP or price feed) but NOT with CircuitBreakerActive
    const result = await attemptV2Liquidation(new anchor.BN(0), new anchor.BN(0));
    expect(result).to.not.match(/CircuitBreakerActive/);
  });

  // ── Test 4: set circuit breaker mid-run, V2 blocked, clear, V2 unblocked ─
  it("BUG-020-04: toggle circuit breaker: set → V2 blocked; clear → V2 unblocked", async () => {
    // Set
    await setCircuitBreaker();
    let result = await attemptV2Liquidation(new anchor.BN(0), new anchor.BN(0));
    expect(result).to.match(/CircuitBreakerActive/);

    // Clear
    await clearCircuitBreaker();
    result = await attemptV2Liquidation(new anchor.BN(0), new anchor.BN(0));
    expect(result).to.not.match(/CircuitBreakerActive/);
  });

  // ── Test 5: V1 cdp_liquidate also blocked (regression) ───────────────────
  it("BUG-020-05: V1 cdp_liquidate also rejects CircuitBreakerActive (regression)", async () => {
    await setCircuitBreaker();
    try {
      await program.methods
        .cdpLiquidate(new anchor.BN(0))
        .accounts({
          liquidator: authority.publicKey,
          config: configPda,
          sssMint: bug020Mint.publicKey,
          liquidatorSssAccount: liquidatorSssAta,
          cdpPosition: cdpPositionPda,
          cdpOwner: cdpOwnerKp.publicKey,
          collateralMint: collateralMint.publicKey,
          collateralVault: collateralVaultPda,
          collateralOwnerAta: collateralOwnerAtaAddr,
          pythPriceFeed: PublicKey.default,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("V1 should have rejected with CircuitBreakerActive");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/CircuitBreakerActive/);
    }
    await clearCircuitBreaker();
  });

  // ── Test 6: non-authority cannot clear circuit breaker ───────────────────
  it("BUG-020-06: non-authority cannot clear FLAG_CIRCUIT_BREAKER", async () => {
    await setCircuitBreaker();
    const attacker = Keypair.generate();
    const sigA = await provider.connection.requestAirdrop(attacker.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sigA);

    try {
      await program.methods
        .clearFeatureFlag(FLAG_CIRCUIT_BREAKER)
        .accounts({
          authority: attacker.publicKey,
          config: configPda,
          mint: bug020Mint.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();
      expect.fail("Should have rejected — attacker is not authority");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/Unauthorized|ConstraintRaw/);
    }
    await clearCircuitBreaker();
  });

  // ── Test 7: V2 with min_collateral_amount > 0 also blocked by circuit breaker ─
  it("BUG-020-07: cdp_liquidate_v2 with min_collateral_amount slippage guard also blocked", async () => {
    await setCircuitBreaker();
    const result = await attemptV2Liquidation(new anchor.BN(0), new anchor.BN(999_999_999));
    expect(result).to.match(/CircuitBreakerActive/);
    await clearCircuitBreaker();
  });

  // ── Test 8: circuit breaker flag value is 1<<0 = 1 ───────────────────────
  it("BUG-020-08: FLAG_CIRCUIT_BREAKER is bit 0 (value 1) — confirmed in feature_flags state", async () => {
    await setCircuitBreaker();
    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    const flags = cfg.featureFlags.toNumber();
    expect(flags & 1).to.equal(1, "bit 0 (FLAG_CIRCUIT_BREAKER) must be set");
    await clearCircuitBreaker();
    const cfg2 = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg2.featureFlags.toNumber() & 1).to.equal(0, "bit 0 must be cleared after clearFeatureFlag");
  });
});
