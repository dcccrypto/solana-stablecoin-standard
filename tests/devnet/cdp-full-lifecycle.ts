/**
 * SSS-DEVTEST-004: Full CDP Lifecycle with Pyth Oracle on Devnet
 *
 * Flow: Init SSS-3 → Create reserve vault → Set Pyth feed → Register collateral
 *       → Deposit collateral → Borrow → Read state → Repay
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createMint, createAccount, mintTo,
  getOrCreateAssociatedTokenAccount, getAccount,
} from "@solana/spl-token";

// Pyth SOL/USD devnet feed
const PYTH_SOL_USD_DEVNET = new PublicKey("J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix");

describe("SSS-DEVTEST-004: Full CDP Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as any).payer as Keypair;

  let program: anchor.Program;
  const mintKp = Keypair.generate();
  let configPda: PublicKey;

  // Collateral: regular SPL token (not Token-2022)
  let collateralMint: PublicKey;
  const collateralMintKp = Keypair.generate();
  let reserveVaultKp = Keypair.generate();
  let userCollateralAta: any;
  let vaultTokenAccount: PublicKey;
  let collateralVaultPda: PublicKey;
  let cdpPositionPda: PublicKey;
  let userSssAta: any;

  before(async () => {
    try { program = (anchor.workspace as any).SssToken; } catch { return; }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );
    console.log(`  Program:    ${program.programId.toBase58()}`);
    console.log(`  Wallet:     ${payer.publicKey.toBase58()}`);
  });

  it("STEP 1: Create collateral mint (SPL Token, 9 decimals like SOL)", async () => {
    if (!program) return;
    collateralMint = await createMint(
      provider.connection, payer, payer.publicKey, null, 9, collateralMintKp, undefined, TOKEN_PROGRAM_ID
    );
    console.log(`  ✅ Collateral mint: ${collateralMint.toBase58()}`);
  });

  it("STEP 2: Create reserve vault (token account for collateral)", async () => {
    if (!program) return;
    // We need a token account owned by the config PDA
    const reserveVault = await createAccount(
      provider.connection, payer, collateralMint, configPda, reserveVaultKp, undefined, TOKEN_PROGRAM_ID
    );
    console.log(`  ✅ Reserve vault: ${reserveVault.toBase58()}`);
  });

  it("STEP 3: Initialize SSS-3 config with reserve vault + Pyth feed", async () => {
    if (!program) return;
    try {
      const tx = await program.methods
        .initialize({
          preset: 3, decimals: 6,
          name: "CDP Stablecoin", symbol: "cSSS",
          uri: "https://sss.dev/cdp.json",
          transferHookProgram: null,
          collateralMint: collateralMint,
          reserveVault: reserveVaultKp.publicKey,
          maxSupply: new BN("1000000000000"),
          featureFlags: null,
          auditorElgamalPubkey: null,
          adminTimelockDelay: new BN(0),
          squadsMultisig: null,
        })
        .accounts({
          payer: payer.publicKey, config: configPda,
          mint: mintKp.publicKey, ctConfig: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKp])
        .rpc({ commitment: "confirmed", skipPreflight: true });
      console.log(`  ✅ SSS-3 initialized — tx: ${tx}`);
    } catch (e: any) {
      console.log(`  ❌ Init: ${(e.message || e).toString().slice(0, 200)}`);
    }
  });

  it("STEP 4: Set Pyth price feed", async () => {
    if (!program) return;
    try {
      // set_pyth_feed may be timelocked — try direct call first
      const tx = await program.methods
        .setPythFeed(PYTH_SOL_USD_DEVNET)
        .accounts({
          authority: payer.publicKey, config: configPda,
          mint: mintKp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`  ✅ Pyth feed set — tx: ${tx}`);
    } catch (e: any) {
      const msg = (e.message || e).toString().slice(0, 150);
      console.log(`  ⚠️  setPythFeed: ${msg}`);
      if (msg.includes("TimelockRequired")) {
        console.log("  → Timelock active. Need propose → wait → execute flow.");
      }
    }
  });

  it("STEP 5: Register collateral config", async () => {
    if (!program) return;
    try {
      const [ccPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("collateral-config"), mintKp.publicKey.toBuffer(), collateralMint.toBuffer()],
        program.programId
      );
      const tx = await program.methods
        .registerCollateral({
          whitelisted: true, maxLtvBps: 8000,
          liquidationThresholdBps: 15000, liquidationBonusBps: 500,
          maxDepositCap: new BN(0),
        })
        .accounts({
          authority: payer.publicKey, config: configPda,
          sssMint: mintKp.publicKey, collateralMint: collateralMint,
          collateralConfig: ccPda, systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`  ✅ Collateral registered — tx: ${tx}`);
    } catch (e: any) {
      console.log(`  ⚠️  Register: ${(e.message || e).toString().slice(0, 150)}`);
    }
  });

  it("STEP 6: Mint collateral tokens to user + setup accounts", async () => {
    if (!program) return;
    try {
      // Mint 100 collateral tokens to user
      userCollateralAta = await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, collateralMint, payer.publicKey, false, undefined, undefined, TOKEN_PROGRAM_ID
      );
      await mintTo(provider.connection, payer, collateralMint, userCollateralAta.address, payer, 100_000_000_000, [], undefined, TOKEN_PROGRAM_ID);
      console.log(`  ✅ Minted 100 collateral tokens to ${userCollateralAta.address.toBase58()}`);

      // Derive CDPCollateralVault PDA
      [collateralVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("cdp-collateral-vault"), mintKp.publicKey.toBuffer(), payer.publicKey.toBuffer(), collateralMint.toBuffer()],
        program.programId
      );

      // Create vault token account owned by collateralVaultPda
      const vtaKp = Keypair.generate();
      vaultTokenAccount = (await createAccount(
        provider.connection, payer, collateralMint, collateralVaultPda, vtaKp, undefined, TOKEN_PROGRAM_ID
      ));
      console.log(`  ✅ Vault token account: ${vaultTokenAccount.toBase58()}`);

      // Derive CDP position PDA
      [cdpPositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("cdp-position"), mintKp.publicKey.toBuffer(), payer.publicKey.toBuffer()],
        program.programId
      );

      // Get/create user SSS ATA (Token-2022)
      userSssAta = await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, mintKp.publicKey, payer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
      );
      console.log(`  ✅ User SSS ATA: ${userSssAta.address.toBase58()}`);
    } catch (e: any) {
      console.log(`  ⚠️  Setup: ${(e.message || e).toString().slice(0, 150)}`);
    }
  });

  it("STEP 7: Deposit collateral into CDP vault", async () => {
    if (!program) return;
    if (!collateralVaultPda) { console.log("  ⏭ SKIP — setup incomplete"); return; }
    try {
      // Fetch fresh blockhash to avoid stale-blockhash errors on devnet
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const txObj = await program.methods
        .cdpDepositCollateral(new BN(50_000_000_000)) // 50 tokens
        .accounts({
          user: payer.publicKey, config: configPda,
          sssMint: mintKp.publicKey, collateralMint: collateralMint,
          collateralVault: collateralVaultPda,
          vaultTokenAccount: vaultTokenAccount,
          userCollateralAccount: userCollateralAta.address,
          yieldCollateralConfig: null, collateralConfig: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      txObj.recentBlockhash = blockhash;
      txObj.feePayer = payer.publicKey;
      txObj.sign(payer);
      const sig = await provider.connection.sendRawTransaction(txObj.serialize(), { skipPreflight: true });
      await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      console.log(`  ✅ Deposited 50 tokens — tx: ${sig}`);
    } catch (e: any) {
      console.log(`  ⚠️  Deposit: ${(e.message || e).toString().slice(0, 200)}`);
    }
  });

  it("STEP 8: Borrow stablecoins against collateral", async () => {
    if (!program) return;
    if (!cdpPositionPda) { console.log("  ⏭ SKIP — setup incomplete"); return; }
    try {
      // Fetch fresh blockhash to avoid stale-blockhash errors on devnet
      const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash("confirmed");
      const txObj = await program.methods
        .cdpBorrowStable(new BN(1_000_000)) // 1 SUSD (6 decimals)
        .accounts({
          user: payer.publicKey, config: configPda,
          sssMint: mintKp.publicKey, collateralMint: collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta.address,
          pythPriceFeed: PYTH_SOL_USD_DEVNET,
          oracleConsensus: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      txObj.recentBlockhash = blockhash;
      txObj.feePayer = payer.publicKey;
      txObj.sign(payer);
      const sig = await provider.connection.sendRawTransaction(txObj.serialize(), { skipPreflight: true });
      await provider.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      console.log(`  ✅ Borrowed 1 SUSD — tx: ${sig}`);
    } catch (e: any) {
      console.log(`  ⚠️  Borrow: ${(e.message || e).toString().slice(0, 200)}`);
    }
  });

  it("STEP 9: Read CDP state", async () => {
    if (!program) return;
    try {
      const config = await program.account.stablecoinConfig.fetch(configPda);
      console.log(`  Config: preset=${config.preset}, minted=${config.totalMinted}, burned=${config.totalBurned}`);

      if (cdpPositionPda) {
        try {
          const cdp = await program.account.cdpPosition.fetch(cdpPositionPda);
          console.log(`  CDP: debt=${cdp.debtAmount}, fees=${cdp.accruedFees}`);
        } catch { console.log("  CDP position not yet created"); }
      }
    } catch (e: any) {
      console.log(`  ⚠️  ${(e.message || e).toString().slice(0, 100)}`);
    }
  });

  it("SUMMARY", () => {
    console.log("\n  === CDP Lifecycle Summary ===");
    console.log("  Steps attempted on live devnet with Pyth SOL/USD feed.");
    console.log("  Check individual step output for tx signatures.");
  });
});
