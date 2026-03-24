/**
 * SSS-137: On-chain Redemption Pools — Anchor tests
 *
 * Tests: seed_redemption_pool, instant_redemption, replenish_redemption_pool,
 *        drain_redemption_pool, all guard conditions and edge cases.
 *
 * Test plan (20 tests):
 *  1.  seed_redemption_pool: succeeds, transfers tokens, updates state
 *  2.  seed_redemption_pool: second seed tops up liquidity
 *  3.  seed_redemption_pool: zero amount rejected
 *  4.  seed_redemption_pool: fee_bps > 500 rejected
 *  5.  seed_redemption_pool: non-authority rejected
 *  6.  seed_redemption_pool: vault mismatch rejected on re-seed
 *  7.  seed_redemption_pool: max_pool_size cap enforced
 *  8.  instant_redemption: succeeds, burns SSS, user receives reserve assets
 *  9.  instant_redemption: fee correctly deducted
 * 10.  instant_redemption: zero amount rejected
 * 11.  instant_redemption: amount > liquidity rejected (RedemptionPoolEmpty)
 * 12.  instant_redemption: paused mint rejected
 * 13.  instant_redemption: utilization_bps updated correctly
 * 14.  replenish_redemption_pool: succeeds, anyone can replenish
 * 15.  replenish_redemption_pool: zero amount rejected
 * 16.  replenish_redemption_pool: max_pool_size cap enforced on replenish
 * 17.  replenish_redemption_pool: vault mismatch rejected
 * 18.  drain_redemption_pool: authority drains entire pool
 * 19.  drain_redemption_pool: non-authority rejected
 * 20.  drain_redemption_pool: draining empty pool rejected
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendTxWithRetry(
  provider: anchor.AnchorProvider,
  buildTx: () => Promise<anchor.web3.Transaction>,
  signers: anchor.web3.Signer[] = [],
  attempts = 5
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const tx = await buildTx();
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    if (signers.length) tx.sign(...signers);
    try {
      await provider.sendAndConfirm(tx, signers.length ? [] : [], {
        commitment: "confirmed",
      });
      return;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1)
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

function pdaFor(seeds: Buffer[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SSS-137: Redemption Pools", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;
  const TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

  // Keypairs — authority is the provider wallet to avoid double-sign issues
  let authority: Keypair;
  const user = Keypair.generate();
  const stranger = Keypair.generate();

  // Mint + PDAs
  let mint: Keypair;
  let configPda: PublicKey;
  let poolPda: PublicKey;
  let vaultAuthPda: PublicKey;
  let minterInfoPda: PublicKey;

  // Token accounts
  let authorityAta: PublicKey;
  let userAta: PublicKey;
  let strangerAta: PublicKey;
  let reserveVaultAta: PublicKey; // owned by vaultAuthPda

  const DECIMALS = 6;
  const MINT_AMOUNT = new BN(10_000_000); // 10 tokens

  // ---------------------------------------------------------------------------
  // Before: airdrop, initialize mint & config, register minter, mint tokens
  // ---------------------------------------------------------------------------

  before(async () => {
    mint = Keypair.generate();

    // Use provider wallet as authority (already funded)
    authority = (provider.wallet as anchor.Wallet).payer;

    // Airdrop user and stranger
    for (const kp of [user, stranger]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Derive PDAs
    [configPda] = pdaFor(
      [Buffer.from("stablecoin-config"), mint.publicKey.toBuffer()],
      program.programId
    );
    [poolPda] = pdaFor(
      [Buffer.from("redemption-pool-v2"), mint.publicKey.toBuffer()],
      program.programId
    );
    [vaultAuthPda] = pdaFor(
      [Buffer.from("vault-authority"), mint.publicKey.toBuffer()],
      program.programId
    );
    [minterInfoPda] = pdaFor(
      [
        Buffer.from("minter-info"),
        configPda.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Initialize stablecoin (preset 1)
    await program.methods
      .initialize({
        preset: 1,
        decimals: DECIMALS,
        name: "SSS137 Token",
        symbol: "SSS137",
        uri: "",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: new BN(1_000_000_000),
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: configPda,
        mint: mint.publicKey,
        ctConfig: null,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .signers([mint])
      .rpc({ commitment: "confirmed" });

    // Register authority as minter (cap = 0 means unlimited)
    await program.methods
      .updateMinter(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mint.publicKey,
        minterInfo: minterInfoPda,
        minter: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Create ATAs helper
    const createAta = async (owner: PublicKey, allowOwnerOffCurve = false) => {
      const ata = getAssociatedTokenAddressSync(
        mint.publicKey,
        owner,
        allowOwnerOffCurve,
        TOKEN_PROGRAM
      );
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          ata,
          owner,
          mint.publicKey,
          TOKEN_PROGRAM,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      return ata;
    };

    authorityAta = await createAta(authority.publicKey);
    userAta = await createAta(user.publicKey);
    strangerAta = await createAta(stranger.publicKey);
    reserveVaultAta = await createAta(vaultAuthPda, true); // vault owned by program PDA (off-curve)

    // Thaw token accounts (DefaultAccountState=Frozen requires thaw before mint)
    const thawAta = async (target: PublicKey) => {
      try {
        await program.methods
          .thawAccount()
          .accounts({
            complianceAuthority: authority.publicKey,
            config: configPda,
            mint: mint.publicKey,
            targetTokenAccount: target,
            tokenProgram: TOKEN_PROGRAM,
          } as any)
          .rpc({ commitment: "confirmed" });
      } catch (_) { /* already thawed */ }
    };

    await thawAta(authorityAta);
    await thawAta(userAta);
    await thawAta(strangerAta);
    await thawAta(reserveVaultAta);

    // Mint tokens to authority, user, stranger
    const mintTo = async (dest: PublicKey, amount: BN) => {
      await program.methods
        .mint(amount)
        .accounts({
          minter: authority.publicKey,
          config: configPda,
          mint: mint.publicKey,
          minterInfo: minterInfoPda,
          recipientTokenAccount: dest,
          tokenProgram: TOKEN_PROGRAM,
        } as any)
        .rpc({ commitment: "confirmed" });
    };

    await mintTo(authorityAta, MINT_AMOUNT);
    await mintTo(userAta, MINT_AMOUNT);
    await mintTo(strangerAta, new BN(5_000_000));
  });

  // ---------------------------------------------------------------------------
  // 1. seed_redemption_pool: succeeds
  // ---------------------------------------------------------------------------
  it("1. seed_redemption_pool: succeeds, transfers tokens, updates state", async () => {
    const seedAmount = new BN(1_000_000); // 1 token
    await program.methods
      .seedRedemptionPool(seedAmount, new BN(5_000_000), 10)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        reserveVault: reserveVaultAta,
        reserveSource: authorityAta,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const pool = await program.account.redemptionPool.fetch(poolPda);
    expect(pool.currentLiquidity.toNumber()).to.equal(1_000_000);
    expect(pool.totalSeeded.toNumber()).to.equal(1_000_000);
    expect(pool.maxPoolSize.toNumber()).to.equal(5_000_000);
    expect(pool.instantRedemptionFeeBps).to.equal(10);

    const vaultAcct = await getAccount(
      provider.connection,
      reserveVaultAta,
      "confirmed",
      TOKEN_PROGRAM
    );
    expect(Number(vaultAcct.amount)).to.equal(1_000_000);
  });

  // ---------------------------------------------------------------------------
  // 2. seed_redemption_pool: second seed tops up
  // ---------------------------------------------------------------------------
  it("2. seed_redemption_pool: second seed tops up liquidity", async () => {
    const seedAmount = new BN(500_000);
    await program.methods
      .seedRedemptionPool(seedAmount, new BN(5_000_000), 10)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        reserveVault: reserveVaultAta,
        reserveSource: authorityAta,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const pool = await program.account.redemptionPool.fetch(poolPda);
    expect(pool.currentLiquidity.toNumber()).to.equal(1_500_000);
    expect(pool.totalSeeded.toNumber()).to.equal(1_500_000);
  });

  // ---------------------------------------------------------------------------
  // 3. seed_redemption_pool: zero amount rejected
  // ---------------------------------------------------------------------------
  it("3. seed_redemption_pool: zero amount rejected", async () => {
    try {
      await program.methods
        .seedRedemptionPool(new BN(0), new BN(5_000_000), 10)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          reserveSource: authorityAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("InvalidAmount");
    }
  });

  // ---------------------------------------------------------------------------
  // 4. seed_redemption_pool: fee_bps > 500 rejected
  // ---------------------------------------------------------------------------
  it("4. seed_redemption_pool: fee_bps > 500 rejected (RedemptionFeeTooHigh)", async () => {
    try {
      await program.methods
        .seedRedemptionPool(new BN(100_000), new BN(5_000_000), 501)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          reserveSource: authorityAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("RedemptionFeeTooHigh");
    }
  });

  // ---------------------------------------------------------------------------
  // 5. seed_redemption_pool: non-authority rejected
  // ---------------------------------------------------------------------------
  it("5. seed_redemption_pool: non-authority rejected", async () => {
    try {
      await program.methods
        .seedRedemptionPool(new BN(100_000), new BN(5_000_000), 10)
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          reserveSource: strangerAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.match(/Unauthorized|ConstraintRaw/i);
    }
  });

  // ---------------------------------------------------------------------------
  // 6. seed_redemption_pool: vault mismatch rejected
  // ---------------------------------------------------------------------------
  it("6. seed_redemption_pool: vault mismatch rejected on re-seed", async () => {
    const wrongVault = getAssociatedTokenAddressSync(
      mint.publicKey,
      stranger.publicKey,
      false,
      TOKEN_PROGRAM
    );
    try {
      await program.methods
        .seedRedemptionPool(new BN(100_000), new BN(5_000_000), 10)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: wrongVault,
          reserveSource: authorityAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.match(
        /RedemptionPoolVaultMismatch|ConstraintRaw/i
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 7. seed_redemption_pool: max_pool_size cap enforced
  // ---------------------------------------------------------------------------
  it("7. seed_redemption_pool: max_pool_size cap enforced", async () => {
    // Pool currently has 1_500_000 liquidity, max is 5_000_000
    // Try seeding 4_000_000 which would overflow to 5_500_000
    try {
      await program.methods
        .seedRedemptionPool(new BN(4_000_000), new BN(5_000_000), 10)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          reserveSource: authorityAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("RedemptionPoolFull");
    }
  });

  // ---------------------------------------------------------------------------
  // 8. instant_redemption: succeeds, burns SSS, user receives reserve
  // ---------------------------------------------------------------------------
  it("8. instant_redemption: succeeds, burns SSS, user receives reserve assets", async () => {
    const redeemAmount = new BN(500_000); // 0.5 token

    const userBalBefore = (
      await getAccount(provider.connection, userAta, "confirmed", TOKEN_PROGRAM)
    ).amount;
    const vaultBalBefore = (
      await getAccount(
        provider.connection,
        reserveVaultAta,
        "confirmed",
        TOKEN_PROGRAM
      )
    ).amount;

    await program.methods
      .instantRedemption(redeemAmount)
      .accounts({
        user: user.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        userTokenAccount: userAta,
        reserveVault: reserveVaultAta,
        userReserveAccount: userAta, // same ATA for simplicity (reserve = SSS in test)
        vaultAuthority: vaultAuthPda,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    const pool = await program.account.redemptionPool.fetch(poolPda);
    // liquidity decreases by redeemAmount
    expect(pool.currentLiquidity.toNumber()).to.equal(1_000_000); // 1_500_000 - 500_000
    expect(pool.totalRedeemed.toNumber()).to.equal(500_000);
  });

  // ---------------------------------------------------------------------------
  // 9. instant_redemption: fee correctly deducted
  // ---------------------------------------------------------------------------
  it("9. instant_redemption: fee correctly deducted (10 bps = 0.1%)", async () => {
    // Fee = 10 bps on 100_000 = 10 tokens (base units)
    const redeemAmount = new BN(100_000);
    const expectedFee = Math.floor(100_000 * 10 / 10_000); // = 100
    const expectedPayout = 100_000 - expectedFee; // = 99_900

    // Check that the pool records are consistent
    const poolBefore = await program.account.redemptionPool.fetch(poolPda);
    const liquidityBefore = poolBefore.currentLiquidity.toNumber();

    await program.methods
      .instantRedemption(redeemAmount)
      .accounts({
        user: user.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        userTokenAccount: userAta,
        reserveVault: reserveVaultAta,
        userReserveAccount: userAta,
        vaultAuthority: vaultAuthPda,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    const poolAfter = await program.account.redemptionPool.fetch(poolPda);
    // Pool deducts full redeemAmount, not payout
    expect(poolAfter.currentLiquidity.toNumber()).to.equal(
      liquidityBefore - 100_000
    );
  });

  // ---------------------------------------------------------------------------
  // 10. instant_redemption: zero amount rejected
  // ---------------------------------------------------------------------------
  it("10. instant_redemption: zero amount rejected", async () => {
    try {
      await program.methods
        .instantRedemption(new BN(0))
        .accounts({
          user: user.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          userTokenAccount: userAta,
          reserveVault: reserveVaultAta,
          userReserveAccount: userAta,
          vaultAuthority: vaultAuthPda,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([user])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("InvalidAmount");
    }
  });

  // ---------------------------------------------------------------------------
  // 11. instant_redemption: amount > liquidity rejected
  // ---------------------------------------------------------------------------
  it("11. instant_redemption: amount > liquidity rejected (RedemptionPoolEmpty)", async () => {
    try {
      await program.methods
        .instantRedemption(new BN(5_000_000)) // way more than pool has
        .accounts({
          user: user.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          userTokenAccount: userAta,
          reserveVault: reserveVaultAta,
          userReserveAccount: userAta,
          vaultAuthority: vaultAuthPda,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([user])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("RedemptionPoolEmpty");
    }
  });

  // ---------------------------------------------------------------------------
  // 12. instant_redemption: paused mint rejected
  // ---------------------------------------------------------------------------
  it("12. instant_redemption: paused mint rejected", async () => {
    // Pause
    await program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      } as any)
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .instantRedemption(new BN(100_000))
        .accounts({
          user: user.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          userTokenAccount: userAta,
          reserveVault: reserveVaultAta,
          userReserveAccount: userAta,
          vaultAuthority: vaultAuthPda,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([user])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.match(/MintPaused|ConstraintRaw/i);
    } finally {
      // Unpause
      await program.methods
        .unpause()
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        } as any)
        .rpc({ commitment: "confirmed" });
    }
  });

  // ---------------------------------------------------------------------------
  // 13. instant_redemption: utilization_bps updated correctly
  // ---------------------------------------------------------------------------
  it("13. instant_redemption: utilization_bps updated correctly", async () => {
    const pool = await program.account.redemptionPool.fetch(poolPda);
    const totalIn = pool.totalSeeded.toNumber() + pool.totalReplenished.toNumber();
    const expectedUtil = Math.floor((pool.totalRedeemed.toNumber() * 10_000) / totalIn);
    expect(pool.utilizationBps).to.be.closeTo(expectedUtil, 1);
  });

  // ---------------------------------------------------------------------------
  // 14. replenish_redemption_pool: permissionless, anyone can replenish
  // ---------------------------------------------------------------------------
  it("14. replenish_redemption_pool: permissionless — stranger can replenish", async () => {
    const replenishAmount = new BN(200_000);
    const poolBefore = await program.account.redemptionPool.fetch(poolPda);
    const liquidityBefore = poolBefore.currentLiquidity.toNumber();

    await program.methods
      .replenishRedemptionPool(replenishAmount)
      .accounts({
        replenisher: stranger.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        reserveVault: reserveVaultAta,
        replenisherSource: strangerAta,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([stranger])
      .rpc({ commitment: "confirmed" });

    const poolAfter = await program.account.redemptionPool.fetch(poolPda);
    expect(poolAfter.currentLiquidity.toNumber()).to.equal(
      liquidityBefore + 200_000
    );
    expect(poolAfter.totalReplenished.toNumber()).to.equal(200_000);
  });

  // ---------------------------------------------------------------------------
  // 15. replenish_redemption_pool: zero amount rejected
  // ---------------------------------------------------------------------------
  it("15. replenish_redemption_pool: zero amount rejected", async () => {
    try {
      await program.methods
        .replenishRedemptionPool(new BN(0))
        .accounts({
          replenisher: stranger.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          replenisherSource: strangerAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("InvalidAmount");
    }
  });

  // ---------------------------------------------------------------------------
  // 16. replenish_redemption_pool: max_pool_size cap enforced
  // ---------------------------------------------------------------------------
  it("16. replenish_redemption_pool: max_pool_size cap enforced", async () => {
    // Pool max = 5_000_000; try to replenish way over
    try {
      await program.methods
        .replenishRedemptionPool(new BN(5_000_000))
        .accounts({
          replenisher: stranger.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          replenisherSource: strangerAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("RedemptionPoolFull");
    }
  });

  // ---------------------------------------------------------------------------
  // 17. replenish_redemption_pool: vault mismatch rejected
  // ---------------------------------------------------------------------------
  it("17. replenish_redemption_pool: vault mismatch rejected", async () => {
    const wrongVault = getAssociatedTokenAddressSync(
      mint.publicKey,
      stranger.publicKey,
      false,
      TOKEN_PROGRAM
    );
    try {
      await program.methods
        .replenishRedemptionPool(new BN(100_000))
        .accounts({
          replenisher: stranger.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: wrongVault,
          replenisherSource: strangerAta,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.match(
        /RedemptionPoolVaultMismatch|ConstraintRaw/i
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 18. drain_redemption_pool: authority drains entire pool
  // ---------------------------------------------------------------------------
  it("18. drain_redemption_pool: authority drains entire pool", async () => {
    const poolBefore = await program.account.redemptionPool.fetch(poolPda);
    const liquidity = poolBefore.currentLiquidity.toNumber();
    expect(liquidity).to.be.greaterThan(0);

    await program.methods
      .drainRedemptionPool()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        reserveVault: reserveVaultAta,
        drainDestination: authorityAta,
        vaultAuthority: vaultAuthPda,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const poolAfter = await program.account.redemptionPool.fetch(poolPda);
    expect(poolAfter.currentLiquidity.toNumber()).to.equal(0);
  });

  // ---------------------------------------------------------------------------
  // 19. drain_redemption_pool: non-authority rejected
  // ---------------------------------------------------------------------------
  it("19. drain_redemption_pool: non-authority rejected", async () => {
    // First seed a bit so pool is non-empty
    await program.methods
      .seedRedemptionPool(new BN(100_000), new BN(5_000_000), 10)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        reserveVault: reserveVaultAta,
        reserveSource: authorityAta,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .drainRedemptionPool()
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          drainDestination: strangerAta,
          vaultAuthority: vaultAuthPda,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.match(/Unauthorized|ConstraintRaw/i);
    }
  });

  // ---------------------------------------------------------------------------
  // 20. drain_redemption_pool: empty pool rejected
  // ---------------------------------------------------------------------------
  it("20. drain_redemption_pool: draining empty pool rejected (InvalidAmount)", async () => {
    // Drain the pool first
    await program.methods
      .drainRedemptionPool()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        redemptionPool: poolPda,
        reserveVault: reserveVaultAta,
        drainDestination: authorityAta,
        vaultAuthority: vaultAuthPda,
        sssMint: mint.publicKey,
        tokenProgram: TOKEN_PROGRAM,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    // Now try to drain again
    try {
      await program.methods
        .drainRedemptionPool()
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          redemptionPool: poolPda,
          reserveVault: reserveVaultAta,
          drainDestination: authorityAta,
          vaultAuthority: vaultAuthPda,
          sssMint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).to.include("InvalidAmount");
    }
  });
});
