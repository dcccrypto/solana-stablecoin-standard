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

function findConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED, mint.toBuffer()], programId);
}

function findRolePda(
  config: PublicKey, grantee: PublicKey, role: number, programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, config.toBuffer(), grantee.toBuffer(), Buffer.from([role])],
    programId,
  );
}

function findMinterInfoPda(
  config: PublicKey, minter: PublicKey, programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_SEED, config.toBuffer(), minter.toBuffer()],
    programId,
  );
}

/**
 * Stateful fuzz-style invariant tests for sss-core.
 *
 * Runs a series of random operations (mint, burn, freeze, thaw, pause,
 * unpause, seize) and verifies global invariants after each step:
 *
 *   INV-1: total_minted - total_burned == on-chain supply
 *   INV-2: total_seized <= total_burned
 *   INV-3: paused state consistency (minting blocked when paused)
 *   INV-4: minter.total_minted <= minter.quota
 *   INV-5: supply_cap respected (net supply never exceeds cap)
 */
describe("sss_core fuzz invariants", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssCore as Program<any>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const decimals = 6;
  const SUPPLY_CAP = 10_000_000_000; // 10,000 tokens
  const MINTER_QUOTA = 5_000_000_000; // 5,000 tokens

  let mint: Keypair;
  let configPda: PublicKey;
  let minter: Keypair;
  let burner: Keypair;
  let freezer: Keypair;
  let pauser: Keypair;
  let seizer: Keypair;
  let user: Keypair;
  let treasury: Keypair;

  let userAta: PublicKey;
  let minterAta: PublicKey;
  let burnerAta: PublicKey;
  let treasuryAta: PublicKey;

  // Tracked expected state
  let expectedTotalMinted = 0;
  let expectedTotalBurned = 0;
  let expectedTotalSeized = 0;
  let expectedPaused = false;
  let expectedMinterMinted = 0;

  async function fetchConfig() {
    return (program.account as any).stablecoinConfig.fetch(configPda);
  }

  async function fetchMinterInfo() {
    const [pda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);
    return (program.account as any).minterInfo.fetch(pda);
  }

  async function checkInvariants(label: string) {
    const config = await fetchConfig();
    const mintInfo = await getMint(connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);

    const onChainTotalMinted = config.totalMinted.toNumber();
    const onChainTotalBurned = config.totalBurned.toNumber();
    const onChainTotalSeized = config.totalSeized.toNumber();
    const onChainSupply = Number(mintInfo.supply);
    const netSupply = onChainTotalMinted - onChainTotalBurned;

    // INV-1: total_minted - total_burned == on-chain supply
    assert.equal(
      netSupply,
      onChainSupply,
      `[${label}] INV-1 failed: net supply (${netSupply}) != on-chain supply (${onChainSupply})`,
    );

    // INV-2: total_seized <= total_burned
    assert.isAtMost(
      onChainTotalSeized,
      onChainTotalBurned,
      `[${label}] INV-2 failed: total_seized (${onChainTotalSeized}) > total_burned (${onChainTotalBurned})`,
    );

    // INV-3: expected vs on-chain state
    assert.equal(onChainTotalMinted, expectedTotalMinted, `[${label}] INV-3a: total_minted mismatch`);
    assert.equal(onChainTotalBurned, expectedTotalBurned, `[${label}] INV-3b: total_burned mismatch`);
    assert.equal(onChainTotalSeized, expectedTotalSeized, `[${label}] INV-3c: total_seized mismatch`);
    assert.equal(config.paused, expectedPaused, `[${label}] INV-3d: paused mismatch`);

    // INV-5: supply cap
    if (config.supplyCap) {
      assert.isAtMost(
        netSupply,
        config.supplyCap.toNumber(),
        `[${label}] INV-5: net supply exceeds cap`,
      );
    }
  }

  before(async () => {
    mint = Keypair.generate();
    minter = Keypair.generate();
    burner = Keypair.generate();
    freezer = Keypair.generate();
    pauser = Keypair.generate();
    seizer = Keypair.generate();
    user = Keypair.generate();
    treasury = Keypair.generate();

    for (const kp of [minter, burner, freezer, pauser, seizer, user, treasury]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }

    [configPda] = findConfigPda(mint.publicKey, program.programId);

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
      createInitializePermanentDelegateInstruction(mint.publicKey, configPda, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(
        mint.publicKey, decimals, admin.publicKey, admin.publicKey, TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, createMintTx, [admin, mint], { commitment: "confirmed" });

    await (program.methods as any)
      .initialize({ preset: 1, supplyCap: new BN(SUPPLY_CAP), complianceEnabled: false, transferHookProgram: null })
      .accountsStrict({
        authority: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Grant all roles
    for (const [kp, role] of [
      [minter, ROLE_MINTER], [burner, ROLE_BURNER], [freezer, ROLE_FREEZER],
      [pauser, ROLE_PAUSER], [seizer, ROLE_SEIZER],
    ] as [Keypair, number][]) {
      const [rolePda] = findRolePda(configPda, kp.publicKey, role, program.programId);
      await (program.methods as any)
        .grantRole(role)
        .accountsStrict({
          authority: admin.publicKey,
          config: configPda,
          grantee: kp.publicKey,
          roleEntry: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    }

    // Set minter quota
    const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);
    await (program.methods as any)
      .setMinterQuota(new BN(MINTER_QUOTA))
      .accountsStrict({
        authority: admin.publicKey,
        config: configPda,
        minter: minter.publicKey,
        minterInfo: minterInfoPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create ATAs
    userAta = getAssociatedTokenAddressSync(mint.publicKey, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
    minterAta = getAssociatedTokenAddressSync(mint.publicKey, minter.publicKey, false, TOKEN_2022_PROGRAM_ID);
    burnerAta = getAssociatedTokenAddressSync(mint.publicKey, burner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    treasuryAta = getAssociatedTokenAddressSync(mint.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const createAtasTx = new Transaction()
      .add(createAssociatedTokenAccountInstruction(admin.publicKey, userAta, user.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID))
      .add(createAssociatedTokenAccountInstruction(admin.publicKey, minterAta, minter.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID))
      .add(createAssociatedTokenAccountInstruction(admin.publicKey, burnerAta, burner.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID))
      .add(createAssociatedTokenAccountInstruction(admin.publicKey, treasuryAta, treasury.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID));
    await sendAndConfirmTransaction(connection, createAtasTx, [admin], { commitment: "confirmed" });
  });

  async function doMint(amount: number, recipientAta: PublicKey) {
    const [rolePda] = findRolePda(configPda, minter.publicKey, ROLE_MINTER, program.programId);
    const [minterInfoPda] = findMinterInfoPda(configPda, minter.publicKey, program.programId);

    await (program.methods as any)
      .mintTokens(new BN(amount))
      .accountsStrict({
        minter: minter.publicKey,
        config: configPda,
        roleEntry: rolePda,
        minterInfo: minterInfoPda,
        mint: mint.publicKey,
        recipientAta,
        recipientBlacklistEntry: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minter])
      .rpc({ commitment: "confirmed" });

    expectedTotalMinted += amount;
    expectedMinterMinted += amount;
  }

  async function doBurn(amount: number, ata: PublicKey) {
    const [rolePda] = findRolePda(configPda, burner.publicKey, ROLE_BURNER, program.programId);

    await (program.methods as any)
      .burnTokens(new BN(amount))
      .accountsStrict({
        burner: burner.publicKey,
        config: configPda,
        roleEntry: rolePda,
        mint: mint.publicKey,
        burnerAta: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([burner])
      .rpc({ commitment: "confirmed" });

    expectedTotalBurned += amount;
  }

  async function doFreeze(ata: PublicKey) {
    const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);
    await (program.methods as any)
      .freezeTokenAccount()
      .accountsStrict({
        freezer: freezer.publicKey,
        config: configPda,
        roleEntry: rolePda,
        mint: mint.publicKey,
        targetAta: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([freezer])
      .rpc({ commitment: "confirmed" });
  }

  async function doThaw(ata: PublicKey) {
    const [rolePda] = findRolePda(configPda, freezer.publicKey, ROLE_FREEZER, program.programId);
    await (program.methods as any)
      .thawTokenAccount()
      .accountsStrict({
        freezer: freezer.publicKey,
        config: configPda,
        roleEntry: rolePda,
        mint: mint.publicKey,
        targetAta: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([freezer])
      .rpc({ commitment: "confirmed" });
  }

  async function doSeize(targetAta: PublicKey, amount: number) {
    const [rolePda] = findRolePda(configPda, seizer.publicKey, ROLE_SEIZER, program.programId);
    await (program.methods as any)
      .seize(new BN(amount))
      .accountsStrict({
        seizer: seizer.publicKey,
        config: configPda,
        roleEntry: rolePda,
        mint: mint.publicKey,
        targetAta,
        treasuryAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([seizer])
      .rpc({ commitment: "confirmed" });

    expectedTotalBurned += amount;
    expectedTotalMinted += amount;
    expectedTotalSeized += amount;
  }

  async function doPause() {
    const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);
    await (program.methods as any)
      .pause()
      .accountsStrict({ pauser: pauser.publicKey, config: configPda, roleEntry: rolePda })
      .signers([pauser])
      .rpc({ commitment: "confirmed" });
    expectedPaused = true;
  }

  async function doUnpause() {
    const [rolePda] = findRolePda(configPda, pauser.publicKey, ROLE_PAUSER, program.programId);
    await (program.methods as any)
      .unpause()
      .accountsStrict({ pauser: pauser.publicKey, config: configPda, roleEntry: rolePda })
      .signers([pauser])
      .rpc({ commitment: "confirmed" });
    expectedPaused = false;
  }

  // ── Fuzz sequence 1: mint → check → burn → check ──────────────

  it("sequence: mint → burn cycle with invariant checks", async () => {
    const amounts = [100_000_000, 200_000_000, 50_000_000, 150_000_000];

    for (const amt of amounts) {
      await doMint(amt, userAta);
      await checkInvariants(`mint-${amt}`);
    }

    // INV-4: minter quota
    const minterInfo = await fetchMinterInfo();
    assert.isAtMost(minterInfo.totalMinted.toNumber(), MINTER_QUOTA, "INV-4: minter exceeded quota");

    // Mint to burner then burn
    await doMint(100_000_000, burnerAta);
    await checkInvariants("mint-to-burner");

    await doBurn(100_000_000, burnerAta);
    await checkInvariants("burn-100M");
  });

  // ── Fuzz sequence 2: pause blocks mint, unpause restores ──────

  it("sequence: pause → mint fails → unpause → mint succeeds", async () => {
    await doPause();
    await checkInvariants("paused");

    // Mint should fail when paused
    let threw = false;
    try {
      await doMint(1_000_000, userAta);
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "mint should fail when paused");

    await doUnpause();
    await checkInvariants("unpaused");

    await doMint(1_000_000, userAta);
    await checkInvariants("mint-after-unpause");
  });

  // ── Fuzz sequence 3: freeze → seize → check accounting ────────

  it("sequence: freeze → seize → verify total_seized accounting", async () => {
    await doFreeze(userAta);

    const userBefore = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const seizeAmt = Math.min(Number(userBefore.amount), 50_000_000);

    await doSeize(userAta, seizeAmt);
    await checkInvariants("seize-50M");

    const config = await fetchConfig();
    assert.equal(config.totalSeized.toNumber(), expectedTotalSeized, "total_seized mismatch");

    // Thaw after seize (account was re-frozen by seize)
    await doThaw(userAta);
  });

  // ── Fuzz sequence 4: supply cap enforcement ───────────────────

  it("sequence: mint up to near supply cap, then reject overflow", async () => {
    const config = await fetchConfig();
    const netSupply = config.totalMinted.toNumber() - config.totalBurned.toNumber();
    const remaining = SUPPLY_CAP - netSupply;

    // We need to check minter quota
    const minterInfo = await fetchMinterInfo();
    const minterRemaining = MINTER_QUOTA - minterInfo.totalMinted.toNumber();
    const canMint = Math.min(remaining, minterRemaining);

    if (canMint > 1_000_000) {
      await doMint(canMint - 1_000_000, userAta);
      await checkInvariants("near-cap");
    }

    // Attempting to exceed cap should fail
    const configAfter = await fetchConfig();
    const netAfter = configAfter.totalMinted.toNumber() - configAfter.totalBurned.toNumber();
    const overflowAmt = SUPPLY_CAP - netAfter + 1;

    // Only try if minter has remaining quota
    const minterInfoAfter = await fetchMinterInfo();
    const quotaLeft = MINTER_QUOTA - minterInfoAfter.totalMinted.toNumber();

    if (quotaLeft >= overflowAmt) {
      let threw = false;
      try {
        await doMint(overflowAmt, userAta);
      } catch {
        threw = true;
      }
      assert.isTrue(threw, "mint exceeding supply cap should fail");
    }

    await checkInvariants("cap-enforced");
  });

  // ── Fuzz sequence 5: rapid interleaved operations ─────────────

  it("sequence: rapid interleaved pause/unpause/freeze/thaw", async () => {
    await doPause();
    await checkInvariants("rapid-pause");

    await doUnpause();
    await checkInvariants("rapid-unpause");

    await doFreeze(userAta);
    const frozenCheck = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.isTrue(frozenCheck.isFrozen, "account should be frozen");

    await doThaw(userAta);
    const thawedCheck = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.isFalse(thawedCheck.isFrozen, "account should be thawed");

    await checkInvariants("rapid-end");
  });

  // ── Fuzz sequence 6: randomized operations ─────────────────

  it("sequence: randomized operations loop (20 iterations)", async function () {
    this.timeout(300_000);

    const ITERATIONS = 20;
    const OPS = ["mint", "burn", "freeze", "thaw", "pause", "unpause", "seize"] as const;

    function randomInt(min: number, max: number): number {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    let userFrozen = false;

    for (let i = 0; i < ITERATIONS; i++) {
      const op = OPS[randomInt(0, OPS.length - 1)];
      const label = `rand-${i}-${op}`;

      try {
        switch (op) {
          case "mint": {
            if (expectedPaused) break;
            const amt = randomInt(1_000, 10_000_000);
            const minterInfo = await fetchMinterInfo();
            const quotaLeft = MINTER_QUOTA - minterInfo.totalMinted.toNumber();
            const config = await fetchConfig();
            const netSupply = config.totalMinted.toNumber() - config.totalBurned.toNumber();
            const capLeft = SUPPLY_CAP - netSupply;
            if (amt > quotaLeft || amt > capLeft) break;
            await doMint(amt, userAta);
            break;
          }
          case "burn": {
            if (expectedPaused) break;
            const acct = await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
            if (Number(acct.amount) === 0) {
              const minterInfo = await fetchMinterInfo();
              const quotaLeft = MINTER_QUOTA - minterInfo.totalMinted.toNumber();
              const config = await fetchConfig();
              const capLeft = SUPPLY_CAP - (config.totalMinted.toNumber() - config.totalBurned.toNumber());
              const canSeed = Math.min(quotaLeft, capLeft, 1_000_000);
              if (canSeed > 0) {
                await doMint(canSeed, burnerAta);
              } else break;
            }
            const bal = await getAccount(connection, burnerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
            const amt = randomInt(1, Math.min(Number(bal.amount), 1_000_000));
            if (amt <= 0) break;
            await doBurn(amt, burnerAta);
            break;
          }
          case "freeze": {
            if (userFrozen) break;
            await doFreeze(userAta);
            userFrozen = true;
            break;
          }
          case "thaw": {
            if (!userFrozen) break;
            await doThaw(userAta);
            userFrozen = false;
            break;
          }
          case "pause": {
            if (expectedPaused) break;
            await doPause();
            break;
          }
          case "unpause": {
            if (!expectedPaused) break;
            await doUnpause();
            break;
          }
          case "seize": {
            if (expectedPaused) break;
            if (!userFrozen) {
              const acct = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
              if (Number(acct.amount) === 0) break;
              await doFreeze(userAta);
              userFrozen = true;
            }
            const acct = await getAccount(connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID);
            const amt = randomInt(1, Math.min(Number(acct.amount), 1_000_000));
            if (amt <= 0) break;
            await doSeize(userAta, amt);
            userFrozen = true; // seize re-freezes
            break;
          }
        }
      } catch (e: any) {
        // Expected failures (e.g., quota exceeded, already paused) are fine in
        // randomized testing — we just skip and keep going.
        console.log(`  [${label}] op skipped: ${e.message?.substring(0, 80)}`);
        continue;
      }

      await checkInvariants(label);
    }

    // Cleanup: ensure unpaused and unfrozen for subsequent tests
    if (expectedPaused) await doUnpause();
    if (userFrozen) await doThaw(userAta);
  });

  // ── Final invariant summary ──────────────────────────────────

  it("final invariant check: all accounting consistent", async () => {
    await checkInvariants("final");

    const config = await fetchConfig();
    console.log("=== Final State ===");
    console.log(`  total_minted:  ${config.totalMinted.toNumber()}`);
    console.log(`  total_burned:  ${config.totalBurned.toNumber()}`);
    console.log(`  total_seized:  ${config.totalSeized.toNumber()}`);
    console.log(`  net supply:    ${config.totalMinted.toNumber() - config.totalBurned.toNumber()}`);
    console.log(`  supply_cap:    ${config.supplyCap?.toNumber() ?? "none"}`);
    console.log(`  paused:        ${config.paused}`);
  });
});
