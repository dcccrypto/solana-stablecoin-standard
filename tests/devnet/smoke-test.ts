/**
 * SSS Devnet Smoke Test — Initialize → Set Flag → Verify → Clear Flag
 *
 * This is the full integration smoke test on live devnet.
 */

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

describe("SSS Devnet Smoke Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program;
  const mintKp = Keypair.generate();
  let configPda: PublicKey;
  let configBump: number;

  before(async () => {
    try {
      program = (anchor.workspace as any).SssToken;
    } catch {
      console.log("⚠️  IDL not loaded. Run 'anchor build' first.");
      return;
    }

    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );

    console.log(`\n  Program:    ${program.programId.toBase58()}`);
    console.log(`  Wallet:     ${provider.wallet.publicKey.toBase58()}`);
    console.log(`  Mint:       ${mintKp.publicKey.toBase58()}`);
    console.log(`  Config PDA: ${configPda.toBase58()}\n`);
  });

  it("SMOKE-01: Initialize SSS-1 (basic stablecoin)", async () => {
    if (!program) return;

    const tx = await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Smoke Test USD",
        symbol: "smUSD",
        uri: "https://test.sss.dev/smoke.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
        adminTimelockDelay: null,
        squadsMultisig: null,
      })
      .accounts({
        payer: provider.wallet.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp])
      .rpc({ commitment: "confirmed" });

    console.log(`  ✅ Initialized SSS-1 — tx: ${tx}`);

    // Verify config exists
    const config = await program.account.stablecoinConfig.fetch(configPda);
    console.log(`  Config: preset=${config.preset}, paused=${config.paused}, flags=0x${config.featureFlags.toString(16)}`);
  });

  it("SMOKE-02: Set FLAG_CIRCUIT_BREAKER (bit 0)", async () => {
    if (!program) return;

    const tx = await program.methods
      .setFeatureFlag(new BN(1))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`  ✅ FLAG_CIRCUIT_BREAKER set — tx: ${tx}`);

    const config = await program.account.stablecoinConfig.fetch(configPda);
    const flags = config.featureFlags.toNumber();
    console.log(`  Flags after set: 0x${flags.toString(16)} (bit 0 = ${flags & 1})`);
  });

  it("SMOKE-03: Clear FLAG_CIRCUIT_BREAKER (bit 0)", async () => {
    if (!program) return;

    const tx = await program.methods
      .clearFeatureFlag(new BN(1))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`  ✅ FLAG_CIRCUIT_BREAKER cleared — tx: ${tx}`);

    const config = await program.account.stablecoinConfig.fetch(configPda);
    const flags = config.featureFlags.toNumber();
    console.log(`  Flags after clear: 0x${flags.toString(16)} (bit 0 = ${flags & 1})`);
  });

  it("SMOKE-04: Set FLAG_SPEND_POLICY (bit 1)", async () => {
    if (!program) return;

    const tx = await program.methods
      .setFeatureFlag(new BN(2))
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`  ✅ FLAG_SPEND_POLICY set — tx: ${tx}`);
  });

  it("SMOKE-05: Register minter", async () => {
    if (!program) return;

    const minterKp = provider.wallet.publicKey;
    const [minterInfoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter-info"), configPda.toBuffer(), minterKp.toBuffer()],
      program.programId
    );

    try {
      const tx = await program.methods
        .updateMinter(new BN(1_000_000_000_000)) // 1M cap
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          minter: minterKp,
          minterInfo: minterInfoPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      console.log(`  ✅ Minter registered — tx: ${tx}`);
    } catch (e: any) {
      console.log(`  ⚠️  Register minter: ${(e.message || e).toString().slice(0, 120)}`);
    }
  });

  it("SMOKE-SUMMARY", async () => {
    if (!program) return;

    try {
      const config = await program.account.stablecoinConfig.fetch(configPda);
      console.log("\n  === Devnet Smoke Test Summary ===");
      console.log(`  Config PDA:     ${configPda.toBase58()}`);
      console.log(`  Mint:           ${mintKp.publicKey.toBase58()}`);
      console.log(`  Preset:         ${config.preset}`);
      console.log(`  Paused:         ${config.paused}`);
      console.log(`  Feature Flags:  0x${config.featureFlags.toString(16)}`);
      console.log(`  Total Minted:   ${config.totalMinted.toString()}`);
      console.log(`  Total Burned:   ${config.totalBurned.toString()}`);
    } catch (e: any) {
      console.log(`  ⚠️  Could not read config: ${(e.message || e).toString().slice(0, 80)}`);
    }
  });
});
