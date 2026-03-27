/**
 * SSS-DEVTEST-003: Feature Flag Integration Test (devnet)
 *
 * Tests set_feature_flag / clear_feature_flag on the deployed SSS program.
 * Program: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-mocha --transpile-only -p ./tsconfig.json -t 300000 \
 *     tests/devnet/feature-flag-test.ts
 *
 * The test:
 *   1. Checks that target/idl/sss_token.json exists (graceful skip if not)
 *   2. Tries to find an existing StablecoinConfig PDA owned by the wallet
 *   3. If none found, initialises a new SSS-1 stablecoin on devnet
 *   4. For each of 8 flags: SET → verify → CLEAR → verify, recording PASS/FAIL
 *   5. Prints a summary table at the end
 */

import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as fs   from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Feature flag bit-values (must match programs/sss-token/src/state.rs)
// NOTE: FLAG_SQUADS_AUTHORITY is bit 13 in state.rs (1 << 13 = 8192).
//       The task specification lists it as (1 << 15) which is
//       FLAG_REQUIRE_OWNER_CONSENT in state.rs.  We use the canonical
//       codebase value (bit 13) and skip it at runtime because setting it
//       locks the config to Squads CPI — unsafe on shared devnet configs.
// ---------------------------------------------------------------------------
const FLAG_CIRCUIT_BREAKER        = new anchor.BN(1 << 0);   // bit 0
const FLAG_SPEND_POLICY           = new anchor.BN(1 << 1);   // bit 1
const FLAG_DAO_COMMITTEE          = new anchor.BN(1 << 2);   // bit 2
const FLAG_YIELD_COLLATERAL       = new anchor.BN(1 << 3);   // bit 3
const FLAG_ZK_COMPLIANCE          = new anchor.BN(1 << 4);   // bit 4
const FLAG_CONFIDENTIAL_TRANSFERS = new anchor.BN(1 << 5);   // bit 5
const FLAG_SQUADS_AUTHORITY       = new anchor.BN(1 << 13);  // bit 13 (canonical)
const FLAG_POR_HALT_ON_BREACH     = new anchor.BN(1 << 16);  // bit 16

interface FlagSpec {
  name:        string;
  value:       anchor.BN;
  /**
   * When true the test verifies the flag SET succeeds but skips CLEAR because
   * the flag causes a state change that blocks direct-authority calls.
   */
  daoLikeBehavior?: boolean;
  /**
   * When set the test records SKIP with this message and does not attempt
   * any on-chain calls.
   */
  skipReason?: string;
}

const FLAGS_UNDER_TEST: FlagSpec[] = [
  { name: "FLAG_CIRCUIT_BREAKER",        value: FLAG_CIRCUIT_BREAKER },
  { name: "FLAG_SPEND_POLICY",           value: FLAG_SPEND_POLICY },
  { name: "FLAG_DAO_COMMITTEE",          value: FLAG_DAO_COMMITTEE,
    daoLikeBehavior: true },
  { name: "FLAG_YIELD_COLLATERAL",       value: FLAG_YIELD_COLLATERAL },
  { name: "FLAG_ZK_COMPLIANCE",          value: FLAG_ZK_COMPLIANCE },
  { name: "FLAG_CONFIDENTIAL_TRANSFERS", value: FLAG_CONFIDENTIAL_TRANSFERS },
  { name: "FLAG_SQUADS_AUTHORITY (bit13)", value: FLAG_SQUADS_AUTHORITY,
    skipReason:
      "FLAG_SQUADS_AUTHORITY is irreversible once set — skipping to avoid " +
      "locking the devnet config to Squads CPI" },
  { name: "FLAG_POR_HALT_ON_BREACH",     value: FLAG_POR_HALT_ON_BREACH },
];

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

interface TestResult {
  flag:    string;
  status:  "PASS" | "FAIL" | "SKIP";
  detail:  string;
  setTx?:  string;
  clearTx?: string;
}

const results: TestResult[] = [];

function printSummary(): void {
  console.log("\n========================================");
  console.log("  SSS-DEVTEST-003: Feature Flag Summary");
  console.log("========================================");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "SKIP" ? "⏭ " : "❌";
    console.log(`  ${icon} [${r.status}] ${r.flag}`);
    if (r.setTx)   console.log(`       set tx   : ${r.setTx}`);
    if (r.clearTx) console.log(`       clear tx : ${r.clearTx}`);
    if (r.detail)  console.log(`       detail   : ${r.detail}`);
  }
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const skip = results.filter(r => r.status === "SKIP").length;
  console.log("----------------------------------------");
  console.log(`  PASS: ${pass}   FAIL: ${fail}   SKIP: ${skip}`);
  console.log("========================================\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the StablecoinConfig PDA for a given mint.
 * Seed: ["stablecoin-config", mint_pubkey]
 */
function deriveConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  );
}

/**
 * Compute the 8-byte Anchor account discriminator for an account name.
 * Formula: sha256("account:<AccountName>")[0..8]
 */
function accountDiscriminator(name: string): Buffer {
  return Buffer.from(
    crypto.createHash("sha256").update(`account:${name}`).digest()
  ).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SSS-DEVTEST-003: Feature Flag Tests (devnet)", () => {

  const REPO_ROOT = path.resolve(__dirname, "../..");
  const IDL_PATH  = path.join(REPO_ROOT, "target", "idl", "sss_token.json");

  // Shared state set up in before() hooks
  let provider:   anchor.AnchorProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program:    any;          // dynamic IDL — typed as any
  let mintPubkey: PublicKey;
  let configPda:  PublicKey;
  let mintKeypair: Keypair | null = null;
  let setupComplete = false;

  // -------------------------------------------------------------------------
  // before #1 — load IDL, build program client
  // -------------------------------------------------------------------------
  before("load IDL and connect to devnet", async function () {
    this.timeout(30_000);

    if (!fs.existsSync(IDL_PATH)) {
      console.error(
        `\n❌ IDL not found at:\n   ${IDL_PATH}\n` +
        `   Run 'anchor build' first or restore target/idl/ from CI artefacts.\n`
      );
      // Pre-populate skipped results so the summary is still printed
      for (const spec of FLAGS_UNDER_TEST) {
        results.push({ flag: spec.name, status: "SKIP", detail: "IDL missing — run anchor build" });
      }
      this.skip();
      return;
    }

    const idlJson  = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
    const programId = new PublicKey(
      idlJson.address ?? "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat"
    );

    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    program  = new anchor.Program(idlJson, provider);

    console.log(`\n  Provider URL : ${provider.connection.rpcEndpoint}`);
    console.log(`  Program ID   : ${programId.toBase58()}`);
    console.log(`  Wallet       : ${provider.wallet.publicKey.toBase58()}`);
  });

  // -------------------------------------------------------------------------
  // before #2 — find or create StablecoinConfig
  // -------------------------------------------------------------------------
  before("find or create StablecoinConfig", async function () {
    this.timeout(120_000);

    if (!program) return; // IDL check failed above

    // ── Attempt to find an existing config owned by wallet ──────────────────
    let foundMint: PublicKey | null   = null;
    let foundConfig: PublicKey | null = null;

    try {
      console.log("\n  🔍 Scanning for existing StablecoinConfig accounts...");
      const disc = accountDiscriminator("StablecoinConfig");

      const accounts = await provider.connection.getProgramAccounts(
        program.programId,
        {
          commitment: "confirmed",
          filters: [
            // discriminator (8 bytes at offset 0)
            { memcmp: { offset: 0,  bytes: anchor.utils.bytes.bs58.encode(disc) } },
            // authority is at offset 8+32 = 40 (after discriminator + mint pubkey)
            { memcmp: { offset: 40, bytes: provider.wallet.publicKey.toBase58() } },
          ],
        }
      );

      if (accounts.length > 0) {
        foundConfig = accounts[0].pubkey;
        const decoded = await program.account["stablecoinConfig"].fetch(foundConfig, "confirmed");
        foundMint   = decoded.mint as PublicKey;

        console.log(`  ✅ Found existing config : ${foundConfig.toBase58()}`);
        console.log(`     Mint                  : ${foundMint.toBase58()}`);
        console.log(`     Current feature_flags : 0x${(decoded.featureFlags as anchor.BN).toString(16)}`);
      } else {
        console.log("     None found.");
      }
    } catch (e: any) {
      console.log(`  ⚠️  Scan failed (${e.message}); will create a fresh config`);
    }

    // ── If found, reuse it ───────────────────────────────────────────────────
    if (foundMint && foundConfig) {
      mintPubkey = foundMint;
      configPda  = foundConfig;
      setupComplete = true;
      return;
    }

    // ── Otherwise, initialise a fresh SSS-1 stablecoin ──────────────────────
    console.log("\n  📦 Initialising new SSS-1 stablecoin on devnet...");

    mintKeypair = Keypair.generate();
    mintPubkey  = mintKeypair.publicKey;
    [configPda] = deriveConfigPda(mintPubkey, program.programId);

    console.log(`     Fresh mint keypair : ${mintPubkey.toBase58()}`);
    console.log(`     Config PDA         : ${configPda.toBase58()}`);

    const lamports = await provider.connection.getBalance(
      provider.wallet.publicKey, "confirmed"
    );
    console.log(`     Wallet balance     : ${(lamports / 1e9).toFixed(4)} SOL`);
    if (lamports < 50_000_000) {
      console.warn("  ⚠️  Balance < 0.05 SOL — init may fail. Run: solana airdrop 1 --url devnet");
    }

    const initTx = await program.methods
      .initialize({
        preset:               1,
        decimals:             6,
        name:                 "DevTest Feature Flags",
        symbol:               "DTFF",
        uri:                  "https://sss.example.com/devtest-003.json",
        transferHookProgram:  null,
        collateralMint:       null,
        reserveVault:         null,
        maxSupply:            null,
        featureFlags:         null,
        auditorElgamalPubkey: null,
        adminTimelockDelay:   new anchor.BN(0), // no timelock for tests
        squadsMultisig:       null,
      })
      .accounts({
        payer:         provider.wallet.publicKey,
        mint:          mintKeypair.publicKey,
        config:        configPda,
        ctConfig:      null,
        tokenProgram:  TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent:          SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc({ commitment: "confirmed" });

    console.log(`  ✅ Init tx : ${initTx}`);

    const initCfg = await program.account["stablecoinConfig"].fetch(configPda, "confirmed");
    expect((initCfg as any).preset).to.equal(1, "Expected SSS-1 preset");

    setupComplete = true;
  });

  // -------------------------------------------------------------------------
  // Per-flag tests
  // -------------------------------------------------------------------------

  for (const spec of FLAGS_UNDER_TEST) {

    it(`feature flag: ${spec.name}`, async function () {
      this.timeout(60_000);

      // ── Hard skip for flags that would permanently break the config ─────
      if (spec.skipReason) {
        results.push({ flag: spec.name, status: "SKIP", detail: spec.skipReason });
        this.skip();
        return;
      }

      // ── Guard: setup may have failed ────────────────────────────────────
      if (!setupComplete || !program) {
        results.push({ flag: spec.name, status: "SKIP", detail: "setup did not complete" });
        this.skip();
        return;
      }

      // ── Read current state ───────────────────────────────────────────────
      let cfg: any;
      try {
        cfg = await program.account["stablecoinConfig"].fetch(configPda, "confirmed");
      } catch (e: any) {
        results.push({ flag: spec.name, status: "FAIL", detail: `fetch failed: ${e.message}` });
        return;
      }

      const currentFlags: anchor.BN = cfg.featureFlags;

      // If FLAG_DAO_COMMITTEE is already active, direct flag changes are blocked
      const daoActive = !currentFlags.and(FLAG_DAO_COMMITTEE).isZero();
      if (daoActive && !spec.daoLikeBehavior) {
        results.push({
          flag:   spec.name,
          status: "SKIP",
          detail: "FLAG_DAO_COMMITTEE is active on this config — direct-authority calls blocked",
        });
        this.skip();
        return;
      }

      const flagAccounts = {
        authority:    provider.wallet.publicKey,
        config:       configPda,
        mint:         mintPubkey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      };

      // ── Pre-clear so we always start from a known-clear state ───────────
      const alreadySet = !currentFlags.and(spec.value).isZero();
      if (alreadySet) {
        try {
          await program.methods
            .clearFeatureFlag(spec.value)
            .accounts(flagAccounts)
            .rpc({ commitment: "confirmed" });
        } catch (_) {
          // Non-fatal — might be DAO flag already active
        }
      }

      // ── SET ──────────────────────────────────────────────────────────────
      let setTx: string;
      try {
        setTx = await program.methods
          .setFeatureFlag(spec.value)
          .accounts(flagAccounts)
          .rpc({ commitment: "confirmed" });
        console.log(`       set tx  : ${setTx}`);
      } catch (e: any) {
        results.push({
          flag:   spec.name,
          status: "FAIL",
          detail: `setFeatureFlag failed: ${e.message}`,
        });
        return;
      }

      // ── Verify SET ───────────────────────────────────────────────────────
      try {
        const afterSet: any = await program.account["stablecoinConfig"].fetch(
          configPda, "confirmed"
        );
        const flagIsSet = !afterSet.featureFlags.and(spec.value).isZero();
        expect(flagIsSet, `${spec.name} should be SET after setFeatureFlag`).to.be.true;
      } catch (e: any) {
        results.push({
          flag:   spec.name,
          status: "FAIL",
          detail: `post-SET verify failed: ${e.message}`,
          setTx,
        });
        return;
      }

      // ── Special: FLAG_DAO_COMMITTEE blocks its own direct clear ──────────
      if (spec.daoLikeBehavior) {
        // Verify that clearFeatureFlag is now rejected
        try {
          await program.methods
            .clearFeatureFlag(spec.value)
            .accounts(flagAccounts)
            .rpc({ commitment: "confirmed" });

          // Should NOT reach here
          results.push({
            flag:   spec.name,
            status: "FAIL",
            detail: "clearFeatureFlag should have been rejected (DaoCommitteeRequired) but succeeded",
            setTx,
          });
        } catch (e: any) {
          const isDaoErr =
            (e?.error?.errorCode?.code === "DaoCommitteeRequired") ||
            (e?.message ?? "").includes("DaoCommitteeRequired");

          if (isDaoErr) {
            console.warn(
              `\n  ⚠️  FLAG_DAO_COMMITTEE is now SET on this config.\n` +
              `      Future direct-authority calls on this config are blocked.\n` +
              `      Use execute_action via DAO proposal flow to modify flags.\n`
            );
            results.push({
              flag:   spec.name,
              status: "PASS",
              detail: "SET succeeded; clearFeatureFlag correctly rejected with DaoCommitteeRequired",
              setTx,
            });
          } else {
            results.push({
              flag:   spec.name,
              status: "FAIL",
              detail: `unexpected error on DAO-block verify: ${e.message}`,
              setTx,
            });
          }
        }
        return;
      }

      // ── CLEAR ────────────────────────────────────────────────────────────
      let clearTx: string;
      try {
        clearTx = await program.methods
          .clearFeatureFlag(spec.value)
          .accounts(flagAccounts)
          .rpc({ commitment: "confirmed" });
        console.log(`       clear tx: ${clearTx}`);
      } catch (e: any) {
        results.push({
          flag:   spec.name,
          status: "FAIL",
          detail: `clearFeatureFlag failed: ${e.message}`,
          setTx,
        });
        return;
      }

      // ── Verify CLEAR ─────────────────────────────────────────────────────
      try {
        const afterClear: any = await program.account["stablecoinConfig"].fetch(
          configPda, "confirmed"
        );
        const flagIsCleared = afterClear.featureFlags.and(spec.value).isZero();
        expect(flagIsCleared, `${spec.name} should be CLEAR after clearFeatureFlag`).to.be.true;
      } catch (e: any) {
        results.push({
          flag:   spec.name,
          status: "FAIL",
          detail: `post-CLEAR verify failed: ${e.message}`,
          setTx,
          clearTx,
        });
        return;
      }

      results.push({
        flag:    spec.name,
        status:  "PASS",
        detail:  "set → verified SET → clear → verified CLEAR",
        setTx,
        clearTx,
      });
    });
  }

  // -------------------------------------------------------------------------
  // After all tests — print summary; fail suite if any flag failed
  // -------------------------------------------------------------------------
  after("print summary", function () {
    printSummary();
    const failures = results.filter(r => r.status === "FAIL");
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} feature flag(s) FAILED: ` +
        failures.map(r => r.flag).join(", ")
      );
    }
  });
});
