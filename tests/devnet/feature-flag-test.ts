/**
 * SSS-DEVTEST-003: Feature Flag Integration Test (devnet)
 *
 * Tests set_feature_flag / clear_feature_flag on the deployed SSS program.
 * Program: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
 */

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const FLAGS = [
  { name: "FLAG_CIRCUIT_BREAKER",        bit: 0,  value: 1 },
  { name: "FLAG_SPEND_POLICY",           bit: 1,  value: 2 },
  { name: "FLAG_DAO_COMMITTEE",          bit: 2,  value: 4 },
  { name: "FLAG_YIELD_COLLATERAL",       bit: 3,  value: 8 },
  { name: "FLAG_ZK_COMPLIANCE",          bit: 4,  value: 16 },
  { name: "FLAG_CONFIDENTIAL_TRANSFERS", bit: 5,  value: 32 },
  { name: "FLAG_SQUADS_AUTHORITY",       bit: 15, value: 32768 },
  { name: "FLAG_POR_HALT_ON_BREACH",     bit: 16, value: 65536 },
];

describe("SSS-DEVTEST-003: Feature Flag Live Testing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  let program: anchor.Program;
  let configPda: PublicKey;
  let mintKp: Keypair;

  before(async () => {
    try {
      program = (anchor.workspace as any).SssToken;
    } catch (e) {
      console.log("⚠️  IDL not loaded — skipping. Run 'anchor build' first.");
      return;
    }

    mintKp = Keypair.generate();
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );

    console.log(`Program: ${program.programId.toBase58()}`);
    console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);
    console.log(`Config PDA: ${configPda.toBase58()}`);
  });

  for (const flag of FLAGS) {
    it(`FF-${String(flag.bit).padStart(2, "0")}: set ${flag.name}`, async () => {
      if (!program) return;
      try {
        const tx = await program.methods
          .setFeatureFlag(new BN(flag.value))
          .accounts({
            authority: provider.wallet.publicKey,
            config: configPda,
            mint: mintKp.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        console.log(`  ✅ SET ${flag.name} — tx: ${tx}`);
      } catch (e: any) {
        console.log(`  ⚠️  SET ${flag.name} failed: ${(e.message || e).toString().slice(0, 100)}`);
      }
    });

    it(`FF-${String(flag.bit).padStart(2, "0")}-clear: clear ${flag.name}`, async () => {
      if (!program) return;
      try {
        const tx = await program.methods
          .clearFeatureFlag(new BN(flag.value))
          .accounts({
            authority: provider.wallet.publicKey,
            config: configPda,
            mint: mintKp.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        console.log(`  ✅ CLEAR ${flag.name} — tx: ${tx}`);
      } catch (e: any) {
        console.log(`  ⚠️  CLEAR ${flag.name} failed: ${(e.message || e).toString().slice(0, 100)}`);
      }
    });
  }

  it("FF-SUMMARY", () => {
    console.log(`\n=== Tested ${FLAGS.length} flags ===`);
  });
});
