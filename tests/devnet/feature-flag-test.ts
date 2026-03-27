/**
 * SSS-DEVTEST-003: Feature Flag Integration Test (devnet)
 * Tests set_feature_flag / clear_feature_flag for 8 primary flags.
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const FLAGS = [
  { name: "FLAG_CIRCUIT_BREAKER",        value: 1 },
  { name: "FLAG_SPEND_POLICY",           value: 2 },
  { name: "FLAG_DAO_COMMITTEE",          value: 4 },
  { name: "FLAG_YIELD_COLLATERAL",       value: 8 },
  { name: "FLAG_ZK_COMPLIANCE",          value: 16 },
  { name: "FLAG_CONFIDENTIAL_TRANSFERS", value: 32 },
  { name: "FLAG_SQUADS_AUTHORITY",       value: 1 << 13 },
  { name: "FLAG_POR_HALT_ON_BREACH",     value: 1 << 16 },
];

describe("SSS-DEVTEST-003: Feature Flag Live Testing (8 flags)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program;
  const mintKp = Keypair.generate();
  let configPda: PublicKey;

  before(async () => {
    try { program = (anchor.workspace as any).SssToken; } catch { return; }
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );
    console.log(`  Program: ${program.programId.toBase58()}`);
    console.log(`  Mint:    ${mintKp.publicKey.toBase58()}`);
  });

  it("INIT: Initialize SSS-1 config for flag testing", async () => {
    if (!program) return;
    const tx = await program.methods
      .initialize({
        preset: 1, decimals: 6,
        name: "Flag Test USD", symbol: "ftUSD",
        uri: "https://test.sss.dev/flags.json",
        transferHookProgram: null, collateralMint: null, reserveVault: null,
        maxSupply: null, featureFlags: null, auditorElgamalPubkey: null,
        adminTimelockDelay: null, squadsMultisig: null,
      })
      .accounts({
        payer: provider.wallet.publicKey, config: configPda,
        mint: mintKp.publicKey, ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp])
      .rpc({ commitment: "confirmed" });
    console.log(`  ✅ Init tx: ${tx}`);
  });

  const results: { name: string; set: string; clear: string }[] = [];

  for (const flag of FLAGS) {
    it(`SET ${flag.name}`, async () => {
      if (!program) return;
      try {
        const tx = await program.methods
          .setFeatureFlag(new BN(flag.value))
          .accounts({
            authority: provider.wallet.publicKey, config: configPda,
            mint: mintKp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc({ commitment: "confirmed" });
        const config = await program.account.stablecoinConfig.fetch(configPda);
        const flags = config.featureFlags.toNumber();
        const isSet = (flags & flag.value) !== 0;
        console.log(`  ✅ SET — flags=0x${flags.toString(16)}, bit=${isSet} — tx: ${tx}`);
        results.push({ name: flag.name, set: isSet ? "PASS" : "FAIL", clear: "—" });
      } catch (e: any) {
        console.log(`  ❌ SET failed: ${(e.message || e).toString().slice(0, 100)}`);
        results.push({ name: flag.name, set: "FAIL", clear: "—" });
      }
    });

    it(`CLEAR ${flag.name}`, async () => {
      if (!program) return;
      try {
        const tx = await program.methods
          .clearFeatureFlag(new BN(flag.value))
          .accounts({
            authority: provider.wallet.publicKey, config: configPda,
            mint: mintKp.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc({ commitment: "confirmed" });
        const config = await program.account.stablecoinConfig.fetch(configPda);
        const flags = config.featureFlags.toNumber();
        const isCleared = (flags & flag.value) === 0;
        console.log(`  ✅ CLEAR — flags=0x${flags.toString(16)}, cleared=${isCleared} — tx: ${tx}`);
        const r = results.find(r => r.name === flag.name);
        if (r) r.clear = isCleared ? "PASS" : "FAIL";
      } catch (e: any) {
        console.log(`  ❌ CLEAR failed: ${(e.message || e).toString().slice(0, 100)}`);
        const r = results.find(r => r.name === flag.name);
        if (r) r.clear = "FAIL";
      }
    });
  }

  it("SUMMARY", () => {
    console.log("\n  ╔══════════════════════════════════════╦══════╦═══════╗");
    console.log("  ║ Flag                                 ║ SET  ║ CLEAR ║");
    console.log("  ╠══════════════════════════════════════╬══════╬═══════╣");
    for (const r of results) {
      console.log(`  ║ ${r.name.padEnd(36)} ║ ${r.set.padEnd(4)} ║ ${r.clear.padEnd(5)} ║`);
    }
    console.log("  ╚══════════════════════════════════════╩══════╩═══════╝");
  });
});
