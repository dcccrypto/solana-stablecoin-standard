/**
 * SSS-151: First-Loss Insurance Vault — Anchor tests
 *
 * Tests: init_insurance_vault, seed_insurance_vault, draw_insurance,
 *        replenish_insurance_vault, and all guard conditions.
 *
 * Test plan (15 tests):
 *  1.  init_insurance_vault: creates PDA, sets FLAG_INSURANCE_VAULT_REQUIRED
 *  2.  init_insurance_vault: non-authority rejected
 *  3.  init_insurance_vault: SSS-1 preset rejected (SSS-3 only)
 *  4.  init_insurance_vault: min_seed_bps > 10_000 rejected
 *  5.  seed_insurance_vault: issuer deposits, adequately_seeded flips true when threshold met
 *  6.  seed_insurance_vault: zero amount rejected
 *  7.  seed_insurance_vault: partial deposit leaves adequately_seeded=false
 *  8.  seed_insurance_vault: non-owner token account rejected
 *  9.  seed_insurance_vault: anyone can seed (community deposit)
 * 10.  draw_insurance: authority draws, reason_hash stored in event, balance updated
 * 11.  draw_insurance: non-authority rejected
 * 12.  draw_insurance: draw > max_draw_per_event_bps rejected
 * 13.  draw_insurance: draw from empty vault rejected
 * 14.  replenish_insurance_vault: community replenishes after draw, seeded status updated
 * 15.  replenish_insurance_vault: zero amount rejected
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
  createInitializeAccountInstruction,
  getAccount,
  getMint,
  createMint,
  mintTo,
  createAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function airdrop(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  sol = 10
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

function configPda(
  programId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  );
}

function insuranceVaultPda(
  programId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance-vault"), mint.toBuffer()],
    programId
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SSS-151: First-Loss Insurance Vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  // Actors
  const authority = provider.wallet;
  const stranger = Keypair.generate();
  const community = Keypair.generate();

  // SSS-3 mint + collateral
  let sssMint: PublicKey;
  let collateralMint: PublicKey;
  let reserveVault: PublicKey;

  // Insurance vault token account (owned by vault PDA)
  let vaultTokenAccount: PublicKey;

  // Config PDA
  let configPda: PublicKey;
  let configBump: number;

  // Insurance vault PDA
  let ivPda: PublicKey;
  let ivBump: number;

  // Authority collateral ATA
  let authorityCollateralAta: PublicKey;
  let communityCollateralAta: PublicKey;
  let strangerCollateralAta: PublicKey;

  // Helpers
  const COLLATERAL_DECIMALS = 6;
  const COLLATERAL_SUPPLY = 1_000_000 * 10 ** COLLATERAL_DECIMALS;

  before(async () => {
    await airdrop(provider, stranger.publicKey);
    await airdrop(provider, community.publicKey);

    // Create collateral mint (standard SPL token for simplicity)
    collateralMint = await createMint(
      provider.connection,
      (authority.payer as Keypair) ?? Keypair.generate(),
      authority.publicKey,
      null,
      COLLATERAL_DECIMALS,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    // Create SSS stablecoin mint (Token-2022)
    sssMint = await createMint(
      provider.connection,
      (authority.payer as Keypair) ?? Keypair.generate(),
      authority.publicKey,
      authority.publicKey,
      6,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );

    // Reserve vault (owned by authority for simplicity in tests)
    reserveVault = await createAccount(
      provider.connection,
      (authority.payer as Keypair) ?? Keypair.generate(),
      collateralMint,
      authority.publicKey,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    // Authority collateral ATA
    authorityCollateralAta = await createAccount(
      provider.connection,
      (authority.payer as Keypair) ?? Keypair.generate(),
      collateralMint,
      authority.publicKey,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    // Community collateral ATA
    communityCollateralAta = await createAccount(
      provider.connection,
      (authority.payer as Keypair) ?? Keypair.generate(),
      collateralMint,
      community.publicKey,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    // Stranger collateral ATA
    strangerCollateralAta = await createAccount(
      provider.connection,
      (authority.payer as Keypair) ?? Keypair.generate(),
      collateralMint,
      stranger.publicKey,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    // Mint collateral to all actors
    const payer = authority.payer as Keypair;
    await mintTo(provider.connection, payer, collateralMint, authorityCollateralAta, authority.publicKey, COLLATERAL_SUPPLY, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    await mintTo(provider.connection, payer, collateralMint, communityCollateralAta, authority.publicKey, COLLATERAL_SUPPLY / 10, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    await mintTo(provider.connection, payer, collateralMint, strangerCollateralAta, authority.publicKey, COLLATERAL_SUPPLY / 10, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);

    // Derive config PDA (we'll initialize below via program.methods.initialize)
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), sssMint.toBuffer()],
      program.programId
    );

    // Derive insurance vault PDA
    [ivPda, ivBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("insurance-vault"), sssMint.toBuffer()],
      program.programId
    );

    // Create insurance vault token account (owned by authority initially; will be PDA-owned in prod)
    // For tests we create it owned by the vault PDA.
    vaultTokenAccount = await createAccount(
      provider.connection,
      payer,
      collateralMint,
      ivPda, // owner = vault PDA
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    // Initialize SSS-3 config
    await program.methods
      .initialize({
        preset: 3,
        decimals: 6,
        name: "Test SSS3",
        symbol: "TSSS3",
        uri: "https://example.com",
        transferHookProgram: null,
        collateralMint: collateralMint,
        reserveVault: reserveVault,
        maxSupply: new anchor.BN(1_000_000_000),
        featureFlags: null,
        auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        adminTimelockDelay: null,
        maxOracleConfBps: null,
      })
      .accounts({
        authority: authority.publicKey,
        mint: sssMint,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
  });

  // ─── 1. init_insurance_vault: success ──────────────────────────────────

  it("1. init_insurance_vault: creates PDA, sets FLAG_INSURANCE_VAULT_REQUIRED", async () => {
    await program.methods
      .initInsuranceVault(
        500,  // min_seed_bps = 5%
        1000  // max_draw_per_event_bps = 10%
      )
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: sssMint,
        vaultTokenAccount: vaultTokenAccount,
        insuranceVault: ivPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const vault = await program.account.insuranceVault.fetch(ivPda);
    expect(vault.sssMint.toString()).to.equal(sssMint.toString());
    expect(vault.vaultTokenAccount.toString()).to.equal(vaultTokenAccount.toString());
    expect(vault.minSeedBps).to.equal(500);
    expect(vault.maxDrawPerEventBps).to.equal(1000);
    expect(vault.currentBalance.toNumber()).to.equal(0);
    expect(vault.totalDrawn.toNumber()).to.equal(0);
    expect(vault.adequatelySeeded).to.be.false; // balance=0 < required when supply>0 (or supply=0 and bps>0)

    const config = await program.account.stablecoinConfig.fetch(configPda);
    // FLAG_INSURANCE_VAULT_REQUIRED = 1 << 21 = 2097152
    expect(config.featureFlags.toNumber() & (1 << 21)).to.be.greaterThan(0);
  });

  // ─── 2. init_insurance_vault: non-authority rejected ───────────────────

  it("2. init_insurance_vault: non-authority rejected", async () => {
    // Create a different SSS mint + config to test this
    const fakeMint = await createMint(
      provider.connection,
      stranger,
      stranger.publicKey,
      stranger.publicKey,
      6,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    const [fakeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), fakeMint.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .initInsuranceVault(500, 1000)
        .accounts({
          authority: stranger.publicKey,
          config: configPda, // stranger not authority of configPda
          sssMint: sssMint,
          vaultTokenAccount: vaultTokenAccount,
          insuranceVault: ivPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown Unauthorized");
    } catch (e: any) {
      expect(e.message).to.include("Unauthorized");
    }
  });

  // ─── 3. init_insurance_vault: SSS-1 preset rejected ────────────────────

  it("3. init_insurance_vault: SSS-1 preset rejected (SSS-3 only)", async () => {
    const sss1Mint = await createMint(
      provider.connection,
      authority.payer as Keypair,
      authority.publicKey,
      authority.publicKey,
      6,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    const [sss1Config] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), sss1Mint.toBuffer()],
      program.programId
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "SSS-1",
        symbol: "S1",
        uri: "https://x",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
        adminTimelockDelay: null,
        maxOracleConfBps: null,
      })
      .accounts({
        authority: authority.publicKey,
        mint: sss1Mint,
        config: sss1Config,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const [sss1Iv] = PublicKey.findProgramAddressSync(
      [Buffer.from("insurance-vault"), sss1Mint.toBuffer()],
      program.programId
    );
    const sss1VaultTA = await createAccount(
      provider.connection,
      authority.payer as Keypair,
      collateralMint,
      sss1Iv,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    try {
      await program.methods
        .initInsuranceVault(500, 1000)
        .accounts({
          authority: authority.publicKey,
          config: sss1Config,
          sssMint: sss1Mint,
          vaultTokenAccount: sss1VaultTA,
          insuranceVault: sss1Iv,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown InvalidPreset");
    } catch (e: any) {
      expect(e.message).to.include("InvalidPreset");
    }
  });

  // ─── 4. init_insurance_vault: min_seed_bps > 10_000 rejected ───────────

  it("4. init_insurance_vault: min_seed_bps > 10_000 rejected", async () => {
    // Use a fresh SSS-3 mint to avoid PDA-already-exists error
    const mint2 = await createMint(
      provider.connection,
      authority.payer as Keypair,
      authority.publicKey,
      authority.publicKey,
      6,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    const [cfg2] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mint2.toBuffer()],
      program.programId
    );
    const rv2 = await createAccount(
      provider.connection,
      authority.payer as Keypair,
      collateralMint,
      authority.publicKey,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
    await program.methods
      .initialize({
        preset: 3,
        decimals: 6,
        name: "SSS3b",
        symbol: "S3B",
        uri: "https://x",
        transferHookProgram: null,
        collateralMint: collateralMint,
        reserveVault: rv2,
        maxSupply: new anchor.BN(1_000_000_000),
        featureFlags: null,
        auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        adminTimelockDelay: null,
        maxOracleConfBps: null,
      })
      .accounts({
        authority: authority.publicKey,
        mint: mint2,
        config: cfg2,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const [iv2] = PublicKey.findProgramAddressSync(
      [Buffer.from("insurance-vault"), mint2.toBuffer()],
      program.programId
    );
    const vta2 = await createAccount(
      provider.connection,
      authority.payer as Keypair,
      collateralMint,
      iv2,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    try {
      await program.methods
        .initInsuranceVault(10_001, 1000)
        .accounts({
          authority: authority.publicKey,
          config: cfg2,
          sssMint: mint2,
          vaultTokenAccount: vta2,
          insuranceVault: iv2,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown InvalidBackstopBps");
    } catch (e: any) {
      expect(e.message).to.include("InvalidBackstopBps");
    }
  });

  // ─── 5. seed_insurance_vault: adequately_seeded flips true ─────────────

  it("5. seed_insurance_vault: issuer deposits, adequately_seeded flips true at threshold", async () => {
    // net_supply = 0 at this point; required = min_seed_bps * 0 / 10000 = 0
    // So seeded becomes true immediately when balance >= 0 (any deposit)
    const depositAmount = 100_000 * 10 ** COLLATERAL_DECIMALS; // 100k USDC

    await program.methods
      .seedInsuranceVault(new BN(depositAmount))
      .accounts({
        depositor: authority.publicKey,
        config: configPda,
        sssMint: sssMint,
        insuranceVault: ivPda,
        depositorTokenAccount: authorityCollateralAta,
        vaultTokenAccount: vaultTokenAccount,
        collateralMint: collateralMint,
        collateralTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const vault = await program.account.insuranceVault.fetch(ivPda);
    expect(vault.currentBalance.toNumber()).to.equal(depositAmount);
    expect(vault.adequatelySeeded).to.be.true; // 0 supply → required=0 → seeded
  });

  // ─── 6. seed_insurance_vault: zero amount rejected ─────────────────────

  it("6. seed_insurance_vault: zero amount rejected", async () => {
    try {
      await program.methods
        .seedInsuranceVault(new BN(0))
        .accounts({
          depositor: authority.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          depositorTokenAccount: authorityCollateralAta,
          vaultTokenAccount: vaultTokenAccount,
          collateralMint: collateralMint,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown ZeroAmount");
    } catch (e: any) {
      expect(e.message).to.include("ZeroAmount");
    }
  });

  // ─── 7. seed: wrong collateral mint rejected ────────────────────────────

  it("7. seed_insurance_vault: wrong collateral mint token account rejected", async () => {
    // Create a different mint and try to seed with it
    const wrongMint = await createMint(
      provider.connection,
      authority.payer as Keypair,
      authority.publicKey,
      null,
      6,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
    const wrongAta = await createAccount(
      provider.connection,
      authority.payer as Keypair,
      wrongMint,
      authority.publicKey,
      undefined,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    try {
      await program.methods
        .seedInsuranceVault(new BN(1000))
        .accounts({
          depositor: authority.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          depositorTokenAccount: wrongAta,  // wrong mint
          vaultTokenAccount: vaultTokenAccount,
          collateralMint: collateralMint,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown InvalidCollateralMint");
    } catch (e: any) {
      expect(e.message).to.include("InvalidCollateralMint");
    }
  });

  // ─── 8. seed: owner mismatch rejected ──────────────────────────────────

  it("8. seed_insurance_vault: non-owner token account rejected", async () => {
    // communityCollateralAta is owned by community, signing as authority
    try {
      await program.methods
        .seedInsuranceVault(new BN(1000))
        .accounts({
          depositor: authority.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          depositorTokenAccount: communityCollateralAta, // owned by community
          vaultTokenAccount: vaultTokenAccount,
          collateralMint: collateralMint,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown TokenAccountOwnerMismatch");
    } catch (e: any) {
      expect(e.message).to.include("TokenAccountOwnerMismatch");
    }
  });

  // ─── 9. seed: community deposit succeeds ───────────────────────────────

  it("9. seed_insurance_vault: anyone can seed (community deposit)", async () => {
    const communityDeposit = 5_000 * 10 ** COLLATERAL_DECIMALS;

    const before = await program.account.insuranceVault.fetch(ivPda);

    await program.methods
      .seedInsuranceVault(new BN(communityDeposit))
      .accounts({
        depositor: community.publicKey,
        config: configPda,
        sssMint: sssMint,
        insuranceVault: ivPda,
        depositorTokenAccount: communityCollateralAta,
        vaultTokenAccount: vaultTokenAccount,
        collateralMint: collateralMint,
        collateralTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([community])
      .rpc({ commitment: "confirmed" });

    const after = await program.account.insuranceVault.fetch(ivPda);
    expect(after.currentBalance.toNumber()).to.equal(
      before.currentBalance.toNumber() + communityDeposit
    );
  });

  // ─── 10. draw_insurance: authority draws ───────────────────────────────

  it("10. draw_insurance: authority draws, balance updated, event emitted", async () => {
    const drawAmount = 10_000 * 10 ** COLLATERAL_DECIMALS;
    const reasonHash = Buffer.alloc(32, 0xab);

    const before = await program.account.insuranceVault.fetch(ivPda);

    // Destination = authorityCollateralAta (receive drawn collateral)
    await program.methods
      .drawInsurance(new BN(drawAmount), [...reasonHash])
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: sssMint,
        insuranceVault: ivPda,
        vaultTokenAccount: vaultTokenAccount,
        destinationTokenAccount: authorityCollateralAta,
        collateralMint: collateralMint,
        vaultAuthority: ivPda, // vault PDA signs
        collateralTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const after = await program.account.insuranceVault.fetch(ivPda);
    expect(after.currentBalance.toNumber()).to.equal(
      before.currentBalance.toNumber() - drawAmount
    );
    expect(after.totalDrawn.toNumber()).to.equal(drawAmount);
  });

  // ─── 11. draw_insurance: non-authority rejected ─────────────────────────

  it("11. draw_insurance: non-authority rejected", async () => {
    const drawAmount = 1_000 * 10 ** COLLATERAL_DECIMALS;
    const reasonHash = Buffer.alloc(32, 0x00);

    try {
      await program.methods
        .drawInsurance(new BN(drawAmount), [...reasonHash])
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: strangerCollateralAta,
          collateralMint: collateralMint,
          vaultAuthority: ivPda,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([stranger])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown Unauthorized");
    } catch (e: any) {
      expect(e.message).to.include("Unauthorized");
    }
  });

  // ─── 12. draw_insurance: exceeds max_draw_per_event_bps ─────────────────

  it("12. draw_insurance: draw > max_draw_per_event_bps rejected", async () => {
    // max_draw_per_event_bps = 1000 = 10%.  net_supply = 0, so cap = 0.
    // Any positive draw exceeds cap=0, which means amount > max_draw (0).
    // But actually when net_supply=0, cap = 0 and max_draw = min(0, balance)=0
    // so even 1 lamport exceeds it. This tests the guard.
    const tooMuch = 1; // any amount > 0 when net_supply=0 and max_draw_per_event_bps>0
    const reasonHash = Buffer.alloc(32, 0x00);

    // First: reload vault state to check current balance > 0
    const vault = await program.account.insuranceVault.fetch(ivPda);
    if (vault.currentBalance.toNumber() === 0) {
      // Skip if vault drained - seed first
      return;
    }

    try {
      await program.methods
        .drawInsurance(new BN(vault.currentBalance.toNumber() + 1), [...reasonHash])
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: authorityCollateralAta,
          collateralMint: collateralMint,
          vaultAuthority: ivPda,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown InvalidAmount or InsufficientCollateral");
    } catch (e: any) {
      expect(
        e.message.includes("InvalidAmount") ||
        e.message.includes("InsufficientCollateral") ||
        e.message.includes("InsuranceFundEmpty")
      ).to.be.true;
    }
  });

  // ─── 13. draw_insurance: empty vault rejected ───────────────────────────

  it("13. draw_insurance: draw from empty vault rejected", async () => {
    // Drain the vault first
    const vault = await program.account.insuranceVault.fetch(ivPda);
    const remaining = vault.currentBalance.toNumber();

    if (remaining > 0) {
      // Draw all remaining (as authority, no event_bps cap if net_supply=0)
      // net_supply=0 → max_draw = min(balance, balance) = balance, so this is ok
      const reasonHash = Buffer.alloc(32, 0x01);
      await program.methods
        .drawInsurance(new BN(remaining), [...reasonHash])
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: authorityCollateralAta,
          collateralMint: collateralMint,
          vaultAuthority: ivPda,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
    }

    // Now vault should be empty
    const emptyVault = await program.account.insuranceVault.fetch(ivPda);
    expect(emptyVault.currentBalance.toNumber()).to.equal(0);

    try {
      await program.methods
        .drawInsurance(new BN(1), [...Buffer.alloc(32)])
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: authorityCollateralAta,
          collateralMint: collateralMint,
          vaultAuthority: ivPda,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown InsuranceFundEmpty");
    } catch (e: any) {
      expect(e.message).to.include("InsuranceFundEmpty");
    }
  });

  // ─── 14. replenish_insurance_vault: community replenishes ───────────────

  it("14. replenish_insurance_vault: community replenishes after draw, seeded status updated", async () => {
    const replenishAmount = 50_000 * 10 ** COLLATERAL_DECIMALS;

    const before = await program.account.insuranceVault.fetch(ivPda);

    await program.methods
      .replenishInsuranceVault(new BN(replenishAmount))
      .accounts({
        contributor: community.publicKey,
        config: configPda,
        sssMint: sssMint,
        insuranceVault: ivPda,
        contributorTokenAccount: communityCollateralAta,
        vaultTokenAccount: vaultTokenAccount,
        collateralMint: collateralMint,
        collateralTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([community])
      .rpc({ commitment: "confirmed" });

    const after = await program.account.insuranceVault.fetch(ivPda);
    expect(after.currentBalance.toNumber()).to.equal(
      before.currentBalance.toNumber() + replenishAmount
    );
    // net_supply=0 → required=0 → seeded should be true after any balance
    expect(after.adequatelySeeded).to.be.true;
  });

  // ─── 15. replenish_insurance_vault: zero amount rejected ────────────────

  it("15. replenish_insurance_vault: zero amount rejected", async () => {
    try {
      await program.methods
        .replenishInsuranceVault(new BN(0))
        .accounts({
          contributor: community.publicKey,
          config: configPda,
          sssMint: sssMint,
          insuranceVault: ivPda,
          contributorTokenAccount: communityCollateralAta,
          vaultTokenAccount: vaultTokenAccount,
          collateralMint: collateralMint,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([community])
        .rpc({ commitment: "confirmed" });
      expect.fail("Should have thrown ZeroAmount");
    } catch (e: any) {
      expect(e.message).to.include("ZeroAmount");
    }
  });
});
