/**
 * SSS-DEVTEST-001: Full Lifecycle Integration Test — Devnet
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import { SolanaStablecoin } from "../sdk/src/SolanaStablecoin";
import { sss1Config } from "../sdk/src/presets";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
const DECIMALS = 6;
const UNIT = BigInt(10 ** DECIMALS);

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf-8"))));
}
function solscan(sig: string) { return `https://solscan.io/tx/${sig}?cluster=devnet`; }

let passed = 0, failed = 0;
const results: { step: string; ok: boolean; detail: string }[] = [];
function log(step: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✅" : "❌"}  ${step}${detail ? "  " + detail : ""}`);
  ok ? passed++ : failed++;
  results.push({ step, ok, detail });
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("  SSS-DEVTEST-001 — Full Lifecycle Integration Test (Devnet)");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = loadKeypair("/home/openclaw/.config/solana/id.json");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const recipient = Keypair.generate();

  // ── STEP 1: Initialize SSS-1 ────────────────────────────────────────────
  console.log("STEP 1: Initialize SSS-1 stablecoin");
  let stablecoin!: SolanaStablecoin;
  try {
    stablecoin = await SolanaStablecoin.create(
      provider,
      sss1Config({ name: "DevTest USD", symbol: "DTSD", decimals: DECIMALS }),
      { programId: PROGRAM_ID }
    );
    log("Initialize SSS-1", true, `mint: ${stablecoin.mint.toBase58()}`);
  } catch (e: any) {
    log("Initialize SSS-1", false, e.message?.slice(0, 80));
    process.exit(1);
  }

  // ── STEP 2: Register minter ─────────────────────────────────────────────
  console.log("\nSTEP 2: Register minter");
  try {
    const sig = await stablecoin.updateMinter({ minter: payer.publicKey, cap: 10_000_000_000n });
    log("Register minter (updateMinter)", true, solscan(sig));
  } catch (e: any) {
    log("Register minter", false, e.message?.slice(0, 80));
  }

  // ── STEP 3: Create ATA + thaw ───────────────────────────────────────────
  console.log("\nSTEP 3: Create recipient ATA + thaw");
  let recipientAta!: PublicKey;
  try {
    const ataInfo = await getOrCreateAssociatedTokenAccount(
      connection, payer, stablecoin.mint, recipient.publicKey,
      false, "confirmed", { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID
    );
    recipientAta = ataInfo.address;
    log("Create recipient ATA", true, recipientAta.toBase58());
  } catch (e: any) {
    log("Create recipient ATA", false, e.message?.slice(0, 80));
    process.exit(1);
  }

  try {
    const sig = await stablecoin.thaw({ tokenAccount: recipientAta });
    log("Thaw recipient ATA", true, solscan(sig));
  } catch (e: any) {
    log("Thaw recipient ATA", false, e.message?.slice(0, 80));
  }

  // ── STEP 4: Mint 1000 DTSD ──────────────────────────────────────────────
  console.log("\nSTEP 4: Mint 1000 DTSD");
  try {
    const sig = await stablecoin.mintTo({ to: recipientAta, amount: 1000n * UNIT });
    log("Mint 1000 DTSD", true, solscan(sig));
    const { netSupply } = await stablecoin.getTotalSupply();
    log("Net supply = 1000 DTSD", netSupply === 1000n * UNIT, `netSupply=${netSupply}`);
  } catch (e: any) {
    log("Mint 1000 DTSD", false, e.message?.slice(0, 80));
  }

  // ── STEP 5: Burn 500 DTSD ───────────────────────────────────────────────
  console.log("\nSTEP 5: Burn 500 DTSD");
  try {
    const sig = await stablecoin.burnFrom({ from: recipientAta, amount: 500n * UNIT, authority: recipient });
    log("Burn 500 DTSD", true, solscan(sig));
    const { netSupply } = await stablecoin.getTotalSupply();
    log("Net supply = 500 DTSD", netSupply === 500n * UNIT, `netSupply=${netSupply}`);
  } catch (e: any) {
    log("Burn 500 DTSD", false, e.message?.slice(0, 80));
  }

  // ── STEP 6: Pause protocol ──────────────────────────────────────────────
  console.log("\nSTEP 6: Pause protocol");
  try {
    const sig = await stablecoin.pause();
    log("Pause protocol", true, solscan(sig));
  } catch (e: any) {
    log("Pause protocol", false, e.message?.slice(0, 80));
  }

  // ── STEP 7: Verify mint fails while paused ──────────────────────────────
  console.log("\nSTEP 7: Verify mint fails while paused");
  try {
    await stablecoin.mintTo({ to: recipientAta, amount: 100n * UNIT });
    log("Mint rejected while paused", false, "mint succeeded — expected failure!");
  } catch (e: any) {
    const isPaused = JSON.stringify(e).toLowerCase().includes("paused");
    log("Mint correctly rejected while paused", isPaused, isPaused ? "Paused error confirmed ✓" : e.message?.slice(0, 60));
  }

  // ── STEP 8: Unpause ─────────────────────────────────────────────────────
  console.log("\nSTEP 8: Unpause protocol");
  try {
    const sig = await stablecoin.unpause();
    log("Unpause protocol", true, solscan(sig));
  } catch (e: any) {
    log("Unpause protocol", false, e.message?.slice(0, 80));
  }

  // ── STEP 9: Verify mint works after unpause ─────────────────────────────
  console.log("\nSTEP 9: Verify mint works after unpause");
  try {
    const sig = await stablecoin.mintTo({ to: recipientAta, amount: 100n * UNIT });
    log("Mint works after unpause", true, solscan(sig));
    const { netSupply } = await stablecoin.getTotalSupply();
    log("Net supply = 600 DTSD", netSupply === 600n * UNIT, `netSupply=${netSupply}`);
  } catch (e: any) {
    log("Mint works after unpause", false, e.message?.slice(0, 80));
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log(`  DEVTEST-001 RESULTS: ${passed} passed / ${failed} failed out of ${passed+failed} steps`);
  if (failed === 0) console.log("  ✅  ALL STEPS PASSED");
  else console.log("  ⚠️   SOME STEPS FAILED");
  console.log(`  Mint: ${stablecoin.mint.toBase58()}`);
  console.log(`  https://solscan.io/account/${stablecoin.mint.toBase58()}?cluster=devnet`);
  console.log("═══════════════════════════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
