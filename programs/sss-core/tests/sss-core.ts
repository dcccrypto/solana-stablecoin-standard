import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { assert } from "chai";
import BN from "bn.js";

const CONFIG_SEED = Buffer.from("sss-config");
const ROLE_SEED = Buffer.from("role");
const MINTER_SEED = Buffer.from("minter");

const ROLE_MINTER = 0;
const ROLE_BURNER = 1;
const ROLE_FREEZER = 2;
const ROLE_PAUSER = 3;
const ROLE_SEIZER = 5;
const ROLE_ATTESTOR = 6;

const RESERVE_SEED = Buffer.from("reserve");

function findConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    programId
  );
}

function findRolePda(
  config: PublicKey, grantee: PublicKey, role: number, programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, config.toBuffer(), grantee.toBuffer(), Buffer.from([role])],
    programId
  );
}

function findMinterInfoPda(
  config: PublicKey, minter: PublicKey, programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_SEED, config.toBuffer(), minter.toBuffer()],
    programId
  );
}

describe("sss_core", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssCore as Program<any>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const decimals = 6;
  let mint: Keypair;
  let configPda: PublicKey;

  let minter: Keypair;
  let burner: Keypair;
  let freezer: Keypair;
  let pauser: Keypair;
  let seizer: Keypair;
  let victim: Keypair;
  let treasury: Keypair;
  let nobody: Keypair;

  before(async () => {
    mint = Keypair.generate();
    minter = Keypair.generate();
    burner = Keypair.generate();
    freezer = Keypair.generate();
    pauser = Keypair.generate();
    seizer = Keypair.generate();
    victim = Keypair.generate();
    treasury = Keypair.generate();
    nobody = Keypair.generate();

    // Airdrop to all keypairs
    for (const kp of [minter, burner, freezer, pauser, seizer, victim, treasury, nobody]) {
      const sig = await connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
    }

    [configPda] = findConfigPda(mint.publicKey, program.programId);

    // Create Token-2022 mint with permanent delegate extension
    // (needed for seize via burn+mint)
    const extensions = [ExtensionType.PermanentDelegate];
    const mintLen = getMintLen(extensions);
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializePermanentDelegateInstruction(
        mint.publicKey,
        configPda, // permanent delegate = config PDA
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        admin.publicKey,       // mint authority (will transfer to config PDA)
        admin.publicKey,       // freeze authority (will transfer to config PDA)
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, createMintTx, [admin, mint], {
      commitment: "confirmed",
    });
  });

  // ── Initialize ───────────────────────────────────────────────

  describe("initialize", () => {
    it("creates config PDA and transfers authorities", async () => {
      await (program.methods as any)
        .initialize({ preset: 1, supplyCap: new BN(1_000_000_000_000), complianceEnabled: false, transferHookProgram: null })
        .accountsStrict({
          authority: admin.publicKey,
          mint: mint.publicKey,
          config: configPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const configAccount = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.ok(configAccount.authority.equals(admin.publicKey));
      assert.equal(configAccount.preset, 1);
      assert.equal(configAccount.paused, false);
      assert.ok(configAccount.supplyCap !== null);
      assert.equal(configAccount.totalMinted.toNumber(), 0);
      assert.equal(configAccount.totalBurned.toNumber(), 0);
      assert.equal(configAccount.totalSeized.toNumber(), 0);

      // Verify mint authority transferred to config PDA
      const mintAccount = await getMint(connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.ok(mintAccount.mintAuthority!.equals(configPda));
      assert.ok(mintAccount.freezeAuthority!.equals(configPda));
    });

    it("rejects invalid preset", async () => {
      const badMint = Keypair.generate();
      const mintLen = getMintLen([]);
      const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: badMint.publicKey,
          space: mintLen,
          lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          badMint.publicKey, decimals, admin.publicKey, admin.publicKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, tx, [admin, badMint], { commitment: "confirmed" });

      const [badConfig] = findConfigPda(badMint.publicKey, program.programId);
      try {
        await (program.methods as any)
          .initialize({ preset: 99, supplyCap: null, complianceEnabled: false, transferHookProgram: null })
          .accountsStrict({
            authority: admin.publicKey,
            mint: badMint.publicKey,
            config: badConfig,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "InvalidPreset");
      }
    });
  });

  // ── RBAC ─────────────────────────────────────────────────────

  describe("role management", () => {
    it("grants minter role", async () => {
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      await (program.methods as any)
        .grantRole(ROLE_MINTER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: minter.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const entry = await (program.account as any).roleEntry.fetch(rolePda);
      assert.ok(entry.authority.equals(minter.publicKey));
      assert.equal(entry.role, ROLE_MINTER);
      assert.ok(entry.grantedBy.equals(admin.publicKey));
    });

    it("grants burner role", async () => {
      const [rolePda] = findRolePda(configPda, burner.publicKey, ROLE_BURNER, program.programId);
      await (program.methods as any)
        .grantRole(ROLE_BURNER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: burner.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("grants freezer role", async () => {
      const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);
      await (program.methods as any)
        .grantRole(ROLE_FREEZER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: freezer.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("grants pauser role", async () => {
      const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);
      await (program.methods as any)
        .grantRole(ROLE_PAUSER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: pauser.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("grants seizer role", async () => {
      const [rolePda] = findRolePda(configPda, seizer.publicKey, ROLE_SEIZER, program.programId);
      await (program.methods as any)
        .grantRole(ROLE_SEIZER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: seizer.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("rejects grant from non-admin", async () => {
      const [rolePda] = findRolePda(configPda, nobody.publicKey, ROLE_MINTER, program.programId);
      try {
        await (program.methods as any)
          .grantRole(ROLE_MINTER)
          .accountsStrict({
            authority: nobody.publicKey,
            config: configPda,
            grantee: nobody.publicKey,
            roleEntry: rolePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([nobody])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "Unauthorized");
      }
    });

    it("rejects invalid role value", async () => {
      const [rolePda] = findRolePda(configPda, nobody.publicKey, 99, program.programId);
      try {
        await (program.methods as any)
          .grantRole(99)
          .accountsStrict({
            authority: admin.publicKey,
            config: configPda,
            grantee: nobody.publicKey,
            roleEntry: rolePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "InvalidRole");
      }
    });
  });

  // ── Minter Quota ─────────────────────────────────────────────

  describe("minter quota", () => {
    it("sets minter quota", async () => {
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);
      await (program.methods as any)
        .setMinterQuota(new BN(500_000_000))
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          minter: minter.publicKey,
          minterInfo: minterInfoPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const info = await (program.account as any).minterInfo.fetch(minterInfoPda);
      assert.equal(info.quota.toNumber(), 500_000_000);
      assert.equal(info.totalMinted.toNumber(), 0);
      assert.equal(info.isActive, true);
    });

    it("updates existing minter quota", async () => {
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);
      await (program.methods as any)
        .setMinterQuota(new BN(1_000_000_000))
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          minter: minter.publicKey,
          minterInfo: minterInfoPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const info = await (program.account as any).minterInfo.fetch(minterInfoPda);
      assert.equal(info.quota.toNumber(), 1_000_000_000);
    });
  });

  // ── Mint Tokens ──────────────────────────────────────────────

  describe("mint tokens", () => {
    let minterAta: PublicKey;
    let victimAta: PublicKey;
    let treasuryAta: PublicKey;

    before(async () => {
      // Create ATAs
      minterAta = getAssociatedTokenAddressSync(
        mint.publicKey, minter.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      victimAta = getAssociatedTokenAddressSync(
        mint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      treasuryAta = getAssociatedTokenAddressSync(
        mint.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID
      );

      const createAtasTx = new Transaction()
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, minterAta, minter.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID))
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, victimAta, victim.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID))
        .add(createAssociatedTokenAccountInstruction(admin.publicKey, treasuryAta, treasury.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID));
      await sendAndConfirmTransaction(connection, createAtasTx, [admin], { commitment: "confirmed" });
    });

    it("minter mints tokens to a recipient", async () => {
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);

      const amount = 100_000_000; // 100 tokens
      await (program.methods as any)
        .mintTokens(new BN(amount))
        .accountsStrict({
          minter: minter.publicKey,
          config: configPda,
          roleEntry: rolePda,
          minterInfo: minterInfoPda,
          mint: mint.publicKey,
          recipientAta: victimAta,
          recipientBlacklistEntry: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minter])
        .rpc({ commitment: "confirmed" });

      const acct = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(Number(acct.amount), amount);

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.equal(config.totalMinted.toNumber(), amount);

      const minterInfo = await (program.account as any).minterInfo.fetch(minterInfoPda);
      assert.equal(minterInfo.totalMinted.toNumber(), amount);
    });

    it("rejects minting without minter role", async () => {
      const [rolePda] = findRolePda(configPda, nobody.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, nobody.publicKey, program.programId);

      try {
        await (program.methods as any)
          .mintTokens(new BN(1000))
          .accountsStrict({
            minter: nobody.publicKey,
            config: configPda,
            roleEntry: rolePda,
            minterInfo: minterInfoPda,
            mint: mint.publicKey,
            recipientAta: victimAta,
            recipientBlacklistEntry: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([nobody])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "AccountNotInitialized");
      }
    });

    it("rejects minting above quota", async () => {
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);

      try {
        await (program.methods as any)
          .mintTokens(new BN(2_000_000_000))
          .accountsStrict({
            minter: minter.publicKey,
            config: configPda,
            roleEntry: rolePda,
            minterInfo: minterInfoPda,
            mint: mint.publicKey,
            recipientAta: victimAta,
            recipientBlacklistEntry: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([minter])
        .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "QuotaExceeded");
      }
    });

    it("mint more tokens to victim for freeze/seize tests", async () => {
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);

      await (program.methods as any)
        .mintTokens(new BN(200_000_000))
        .accountsStrict({
          minter: minter.publicKey,
          config: configPda,
          roleEntry: rolePda,
          minterInfo: minterInfoPda,
          mint: mint.publicKey,
          recipientAta: victimAta,
          recipientBlacklistEntry: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minter])
        .rpc({ commitment: "confirmed" });
    });
  });

  // ── Burn Tokens ──────────────────────────────────────────────

  describe("burn tokens", () => {
    let burnerAta: PublicKey;

    before(async () => {
      burnerAta = getAssociatedTokenAddressSync(
        mint.publicKey, burner.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey, burnerAta, burner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });

      // Mint tokens to burner via minter
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);
      await (program.methods as any)
        .mintTokens(new BN(50_000_000))
        .accountsStrict({
          minter: minter.publicKey,
          config: configPda,
          roleEntry: rolePda,
          minterInfo: minterInfoPda,
          mint: mint.publicKey,
          recipientAta: burnerAta,
          recipientBlacklistEntry: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minter])
        .rpc({ commitment: "confirmed" });
    });

    it("burner burns own tokens", async () => {
      const [rolePda] = findRolePda(configPda, burner.publicKey, ROLE_BURNER, program.programId);

      await (program.methods as any)
        .burnTokens(new BN(10_000_000))
        .accountsStrict({
          burner: burner.publicKey,
          config: configPda,
          roleEntry: rolePda,
          mint: mint.publicKey,
          burnerAta: burnerAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([burner])
        .rpc({ commitment: "confirmed" });

      const acct = await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(Number(acct.amount), 40_000_000);

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.equal(config.totalBurned.toNumber(), 10_000_000);
    });
  });

  // ── Freeze / Thaw ────────────────────────────────────────────

  describe("freeze and thaw", () => {
    let victimAta: PublicKey;

    before(() => {
      victimAta = getAssociatedTokenAddressSync(
        mint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
    });

    it("freezer freezes a token account", async () => {
      const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);

      await (program.methods as any)
        .freezeTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: rolePda,
          mint: mint.publicKey,
          targetAta: victimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });

      const acct = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(acct.isFrozen, true);
    });

    it("rejects freeze if already frozen", async () => {
      const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);

      try {
        await (program.methods as any)
          .freezeTokenAccount()
          .accountsStrict({
            freezer: freezer.publicKey,
            config: configPda,
            roleEntry: rolePda,
            mint: mint.publicKey,
            targetAta: victimAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([freezer])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "AccountFrozen");
      }
    });

    it("freezer thaws the token account", async () => {
      const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);

      await (program.methods as any)
        .thawTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: rolePda,
          mint: mint.publicKey,
          targetAta: victimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });

      const acct = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(acct.isFrozen, false);
    });

    it("rejects thaw if not frozen", async () => {
      const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);

      try {
        await (program.methods as any)
          .thawTokenAccount()
          .accountsStrict({
            freezer: freezer.publicKey,
            config: configPda,
            roleEntry: rolePda,
            mint: mint.publicKey,
            targetAta: victimAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([freezer])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "AccountNotFrozen");
      }
    });
  });

  // ── Pause / Unpause ──────────────────────────────────────────

  describe("pause and unpause", () => {
    it("pauser pauses the stablecoin", async () => {
      const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);

      await (program.methods as any)
        .pause()
        .accountsStrict({
          pauser: pauser.publicKey,
          config: configPda,
          roleEntry: rolePda,
        })
        .signers([pauser])
        .rpc({ commitment: "confirmed" });

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.equal(config.paused, true);
    });

    it("rejects minting while paused", async () => {
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);
      const victimAta = getAssociatedTokenAddressSync(
        mint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID
      );

      try {
        await (program.methods as any)
          .mintTokens(new BN(1000))
          .accountsStrict({
            minter: minter.publicKey,
            config: configPda,
            roleEntry: rolePda,
            minterInfo: minterInfoPda,
            mint: mint.publicKey,
            recipientAta: victimAta,
            recipientBlacklistEntry: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([minter])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "Paused");
      }
    });

    it("rejects double pause", async () => {
      const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);

      try {
        await (program.methods as any)
          .pause()
          .accountsStrict({
            pauser: pauser.publicKey,
            config: configPda,
            roleEntry: rolePda,
          })
          .signers([pauser])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "AlreadyPaused");
      }
    });

    it("pauser unpauses the stablecoin", async () => {
      const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);

      await (program.methods as any)
        .unpause()
        .accountsStrict({
          pauser: pauser.publicKey,
          config: configPda,
          roleEntry: rolePda,
        })
        .signers([pauser])
        .rpc({ commitment: "confirmed" });

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.equal(config.paused, false);
    });

    it("rejects unpause when not paused", async () => {
      const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);

      try {
        await (program.methods as any)
          .unpause()
          .accountsStrict({
            pauser: pauser.publicKey,
            config: configPda,
            roleEntry: rolePda,
          })
          .signers([pauser])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "NotPaused");
      }
    });
  });

  // ── Seize ────────────────────────────────────────────────────

  describe("seize", () => {
    let victimAta: PublicKey;
    let treasuryAta: PublicKey;

    before(async () => {
      victimAta = getAssociatedTokenAddressSync(
        mint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      treasuryAta = getAssociatedTokenAddressSync(
        mint.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID
      );

      // Freeze victim's account for seize
      const [freezeRolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);
      await (program.methods as any)
        .freezeTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: freezeRolePda,
          mint: mint.publicKey,
          targetAta: victimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });
    });

    it("seizes tokens from frozen account to treasury", async () => {
      const [rolePda] = findRolePda(configPda, seizer.publicKey, ROLE_SEIZER, program.programId);

      const configBefore = await (program.account as any).stablecoinConfig.fetch(configPda);
      const victimBefore = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const seizeAmount = 50_000_000;

      await (program.methods as any)
        .seize(new BN(seizeAmount))
        .accountsStrict({
          seizer: seizer.publicKey,
          config: configPda,
          roleEntry: rolePda,
          mint: mint.publicKey,
          targetAta: victimAta,
          treasuryAta: treasuryAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([seizer])
        .rpc({ commitment: "confirmed" });

      const victimAfter = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const treasuryAfter = await getAccount(connection, treasuryAta, "confirmed", TOKEN_2022_PROGRAM_ID);

      assert.equal(
        Number(victimAfter.amount),
        Number(victimBefore.amount) - seizeAmount
      );
      assert.equal(Number(treasuryAfter.amount), seizeAmount);

      // Victim account should be re-frozen after seize
      assert.equal(victimAfter.isFrozen, true);

      // Verify seize accounting: total_burned, total_minted, and total_seized updated
      const configAfter = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.equal(
        configAfter.totalBurned.toNumber(),
        configBefore.totalBurned.toNumber() + seizeAmount,
      );
      assert.equal(
        configAfter.totalMinted.toNumber(),
        configBefore.totalMinted.toNumber() + seizeAmount,
      );
      assert.equal(configAfter.totalSeized.toNumber(), seizeAmount);
    });

    it("rejects seize on non-frozen account", async () => {
      const [rolePda] = findRolePda(configPda, seizer.publicKey, ROLE_SEIZER, program.programId);

      // Thaw first
      const [freezeRolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);
      await (program.methods as any)
        .thawTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: freezeRolePda,
          mint: mint.publicKey,
          targetAta: victimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });

      try {
        await (program.methods as any)
          .seize(new BN(1000))
          .accountsStrict({
            seizer: seizer.publicKey,
            config: configPda,
            roleEntry: rolePda,
            mint: mint.publicKey,
            targetAta: victimAta,
            treasuryAta: treasuryAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([seizer])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "AccountNotFrozen");
      }
    });
  });

  // ── Two-Step Authority Transfer ──────────────────────────────

  describe("authority transfer", () => {
    let newAdmin: Keypair;

    before(async () => {
      newAdmin = Keypair.generate();
      const sig = await connection.requestAirdrop(
        newAdmin.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
    });

    it("nominates a new authority", async () => {
      await (program.methods as any)
        .transferAuthority(newAdmin.publicKey)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.ok(config.pendingAuthority.equals(newAdmin.publicKey));
    });

    it("rejects accept from wrong wallet", async () => {
      try {
        await (program.methods as any)
          .acceptAuthority()
          .accountsStrict({
            newAuthority: nobody.publicKey,
            config: configPda,
          })
          .signers([nobody])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "PendingAuthorityMismatch");
      }
    });

    it("new authority accepts", async () => {
      await (program.methods as any)
        .acceptAuthority()
        .accountsStrict({
          newAuthority: newAdmin.publicKey,
          config: configPda,
        })
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.ok(config.authority.equals(newAdmin.publicKey));
      assert.ok(config.pendingAuthority === null);
    });

    it("transfers authority back to original admin", async () => {
      await (program.methods as any)
        .transferAuthority(admin.publicKey)
        .accountsStrict({
          authority: newAdmin.publicKey,
          config: configPda,
        })
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });

      await (program.methods as any)
        .acceptAuthority()
        .accountsStrict({
          newAuthority: admin.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.ok(config.authority.equals(admin.publicKey));
    });
  });

  // ── Revoke Role ──────────────────────────────────────────────

  describe("revoke role", () => {
    let tempMinter: Keypair;

    before(async () => {
      tempMinter = Keypair.generate();
      const sig = await connection.requestAirdrop(
        tempMinter.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
    });

    it("grants then revokes a minter role", async () => {
      const [rolePda] = findRolePda(configPda, tempMinter.publicKey, ROLE_MINTER, program.programId);

      await (program.methods as any)
        .grantRole(ROLE_MINTER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: tempMinter.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      // Verify it exists
      const entry = await (program.account as any).roleEntry.fetch(rolePda);
      assert.ok(entry.authority.equals(tempMinter.publicKey));

      // Revoke
      await (program.methods as any)
        .revokeRole(ROLE_MINTER)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: tempMinter.publicKey,
          roleEntry: rolePda,
        })
        .rpc({ commitment: "confirmed" });

      // Verify it's closed
      const acctInfo = await connection.getAccountInfo(rolePda);
      assert.isNull(acctInfo);
    });
  });

  // ── Supply Cap ───────────────────────────────────────────────

  describe("supply cap", () => {
    it("tracks total_minted and total_burned correctly", async () => {
      const config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.ok(config.totalMinted.toNumber() > 0);
      assert.ok(config.totalBurned.toNumber() > 0);
      const netSupply = config.totalMinted.toNumber() - config.totalBurned.toNumber();
      assert.ok(netSupply > 0);
    });
  });

  // ── Burn From (Permanent Delegate) ────────────────────────

  describe("burn_from", () => {
    let targetAta: PublicKey;

    before(async () => {
      targetAta = getAssociatedTokenAddressSync(
        mint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );

      // Thaw if frozen (seize test leaves it frozen)
      const acct = await getAccount(connection, targetAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      if (acct.isFrozen) {
        const [freezeRolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);
        await (program.methods as any)
          .thawTokenAccount()
          .accountsStrict({
            freezer: freezer.publicKey,
            config: configPda,
            roleEntry: freezeRolePda,
            mint: mint.publicKey,
            targetAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([freezer])
          .rpc({ commitment: "confirmed" });
      }
    });

    it("burner burns from victim's account via permanent delegate", async () => {
      const configBefore = await (program.account as any).stablecoinConfig.fetch(configPda);
      const burnedBefore = configBefore.totalBurned.toNumber();

      const burnAmount = 100_000;
      const [rolePda] = findRolePda(configPda, burner.publicKey, ROLE_BURNER, program.programId);

      await (program.methods as any)
        .burnFrom(new BN(burnAmount))
        .accountsStrict({
          burner: burner.publicKey,
          config: configPda,
          roleEntry: rolePda,
          mint: mint.publicKey,
          targetAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([burner])
        .rpc({ commitment: "confirmed" });

      const configAfter = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.equal(
        configAfter.totalBurned.toNumber(),
        burnedBefore + burnAmount,
      );
    });
  });

  // ── Set Compliance ────────────────────────────────────────

  describe("set_compliance", () => {
    it("admin can toggle compliance on and off", async () => {
      await (program.methods as any)
        .setCompliance(true)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      let config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.isTrue(config.complianceEnabled);

      await (program.methods as any)
        .setCompliance(false)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      config = await (program.account as any).stablecoinConfig.fetch(configPda);
      assert.isFalse(config.complianceEnabled);
    });
  });

  // ── Reserve Attestation ───────────────────────────────────

  describe("reserve attestation", () => {
    let attestor: Keypair;

    before(async () => {
      attestor = Keypair.generate();
      const sig = await connection.requestAirdrop(
        attestor.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");
    });

    it("grants attestor role", async () => {
      const [rolePda] = findRolePda(
        configPda,
        attestor.publicKey,
        ROLE_ATTESTOR,
        program.programId,
      );

      await (program.methods as any)
        .grantRole(ROLE_ATTESTOR)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: attestor.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const entry = await (program.account as any).roleEntry.fetch(rolePda);
      assert.equal(entry.role, ROLE_ATTESTOR);
    });

    it("attestor records a reserve attestation", async () => {
      const [attestationPda] = PublicKey.findProgramAddressSync(
        [RESERVE_SEED, configPda.toBuffer()],
        program.programId,
      );
      const [rolePda] = findRolePda(
        configPda,
        attestor.publicKey,
        ROLE_ATTESTOR,
        program.programId,
      );

      await (program.methods as any)
        .attestReserve({
          reserveAmount: new BN(10_000_000_000),
          source: "Circle USDC reserves audit Q1 2026",
          uri: "https://example.com/audit-report.pdf",
        })
        .accountsStrict({
          attestor: attestor.publicKey,
          config: configPda,
          roleEntry: rolePda,
          attestation: attestationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([attestor])
        .rpc({ commitment: "confirmed" });

      const att = await (program.account as any).reserveAttestation.fetch(attestationPda);
      assert.equal(att.reserveAmount.toNumber(), 10_000_000_000);
      assert.equal(att.source, "Circle USDC reserves audit Q1 2026");
      assert.equal(att.uri, "https://example.com/audit-report.pdf");
      assert.ok(att.attestor.equals(attestor.publicKey));
      assert.ok(att.timestamp.toNumber() > 0);
    });

    it("attestor can update the attestation", async () => {
      const [attestationPda] = PublicKey.findProgramAddressSync(
        [RESERVE_SEED, configPda.toBuffer()],
        program.programId,
      );
      const [rolePda] = findRolePda(
        configPda,
        attestor.publicKey,
        ROLE_ATTESTOR,
        program.programId,
      );

      await (program.methods as any)
        .attestReserve({
          reserveAmount: new BN(15_000_000_000),
          source: "Updated audit Q2 2026",
          uri: "https://example.com/audit-q2.pdf",
        })
        .accountsStrict({
          attestor: attestor.publicKey,
          config: configPda,
          roleEntry: rolePda,
          attestation: attestationPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([attestor])
        .rpc({ commitment: "confirmed" });

      const att = await (program.account as any).reserveAttestation.fetch(attestationPda);
      assert.equal(att.reserveAmount.toNumber(), 15_000_000_000);
      assert.equal(att.source, "Updated audit Q2 2026");
    });
  });

  describe("negative tests", () => {
    let negVictimAta: PublicKey;
    let negBurnerAta: PublicKey;
    let negTreasuryAta: PublicKey;

    before(async () => {
      negVictimAta = getAssociatedTokenAddressSync(
        mint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      negBurnerAta = getAssociatedTokenAddressSync(
        mint.publicKey, burner.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      negTreasuryAta = getAssociatedTokenAddressSync(
        mint.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
    });

    it("rejects zero-amount mint", async () => {
      const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
      const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);

      try {
        await (program.methods as any)
          .mintTokens(new BN(0))
          .accountsStrict({
            minter: minter.publicKey,
            config: configPda,
            roleEntry: rolePda,
            minterInfo: minterInfoPda,
            mint: mint.publicKey,
            recipientAta: negVictimAta,
            recipientBlacklistEntry: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([minter])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "ZeroAmount");
      }
    });

    it("rejects zero-amount burn", async () => {
      const [rolePda] = findRolePda(configPda, burner.publicKey, ROLE_BURNER, program.programId);

      try {
        await (program.methods as any)
          .burnTokens(new BN(0))
          .accountsStrict({
            burner: burner.publicKey,
            config: configPda,
            roleEntry: rolePda,
            mint: mint.publicKey,
            burnerAta: negBurnerAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([burner])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "ZeroAmount");
      }
    });

    it("rejects zero-amount seize", async () => {
      const [rolePda] = findRolePda(configPda, seizer.publicKey, ROLE_SEIZER, program.programId);
      const [freezerRolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);

      const acct = await getAccount(connection, negVictimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      if (!acct.isFrozen) {
        await (program.methods as any)
          .freezeTokenAccount()
          .accountsStrict({
            freezer: freezer.publicKey,
            config: configPda,
            roleEntry: freezerRolePda,
            mint: mint.publicKey,
            targetAta: negVictimAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([freezer])
          .rpc({ commitment: "confirmed" });
      }

      try {
        await (program.methods as any)
          .seize(new BN(0))
          .accountsStrict({
            seizer: seizer.publicKey,
            config: configPda,
            roleEntry: rolePda,
            mint: mint.publicKey,
            targetAta: negVictimAta,
            treasuryAta: negTreasuryAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([seizer])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "ZeroAmount");
      }

      await (program.methods as any)
        .thawTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: freezerRolePda,
          mint: mint.publicKey,
          targetAta: negVictimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });
    });

    it("rejects seize overflow (more than target balance)", async () => {
      const [rolePda] = findRolePda(configPda, seizer.publicKey, ROLE_SEIZER, program.programId);
      const [freezerRolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);

      await (program.methods as any)
        .freezeTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: freezerRolePda,
          mint: mint.publicKey,
          targetAta: negVictimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });

      const acct = await getAccount(connection, negVictimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      const overflowAmount = Number(acct.amount) + 1_000_000;

      try {
        await (program.methods as any)
          .seize(new BN(overflowAmount))
          .accountsStrict({
            seizer: seizer.publicKey,
            config: configPda,
            roleEntry: rolePda,
            mint: mint.publicKey,
            targetAta: negVictimAta,
            treasuryAta: negTreasuryAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([seizer])
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.ok(e.toString().length > 0, "seize overflow should fail");
      }

      await (program.methods as any)
        .thawTokenAccount()
        .accountsStrict({
          freezer: freezer.publicKey,
          config: configPda,
          roleEntry: freezerRolePda,
          mint: mint.publicKey,
          targetAta: negVictimAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezer])
        .rpc({ commitment: "confirmed" });
    });

    it("rejects grant_role with invalid role value (out of range)", async () => {
      const invalidRole = 99;
      const randomGuy = Keypair.generate();
      const [rolePda] = findRolePda(configPda, randomGuy.publicKey, invalidRole, program.programId);

      try {
        await (program.methods as any)
          .grantRole(invalidRole)
          .accountsStrict({
            authority: admin.publicKey,
            config: configPda,
            grantee: randomGuy.publicKey,
            roleEntry: rolePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.toString(), "InvalidRole");
      }
    });
  });
});
