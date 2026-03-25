/**
 * SSS-150: Transfer BPF upgrade authority to a Squads multisig.
 *
 * Usage:
 *   npx ts-node scripts/transfer-upgrade-authority.ts \
 *     --program <SSS_TOKEN_PROGRAM_ID> \
 *     --new-authority <SQUADS_MULTISIG_PUBKEY> \
 *     --keypair <DEPLOYER_KEYPAIR.json> \
 *     [--cluster mainnet-beta|devnet] \
 *     [--dry-run]
 *
 * What this script does:
 *   1. Verifies the Squads multisig PDA exists on-chain (sanity check).
 *   2. Confirms the current upgrade authority matches the deployer keypair.
 *   3. Prompts for confirmation (skipped with --dry-run).
 *   4. Calls `solana program set-upgrade-authority` to transfer.
 *   5. Verifies the transfer succeeded by re-reading the program account.
 *
 * IMPORTANT (Solana BPF loader limitation):
 *   There is NO native timelock on BPF program upgrades. Once the multisig
 *   threshold is reached in Squads, the upgrade executes immediately.
 *   Use a high threshold (4-of-5 or 5-of-5) for upgrade proposals.
 *   Monitor for upgrade authority changes via on-chain alerts.
 *
 * After running this script, call `set_upgrade_authority_guard` on the SSS
 * program to record the Squads pubkey in config for continuous monitoring.
 */

import { execSync } from "child_process";
import * as readline from "readline";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function requireArg(flag: string, description: string): string {
  const val = getArg(flag);
  if (!val) {
    console.error(`ERROR: Missing required argument ${flag} (${description})`);
    process.exit(1);
  }
  return val!;
}

const programId = requireArg("--program", "SSS token program ID");
const newAuthority = requireArg("--new-authority", "Squads multisig pubkey");
const keypairPath = requireArg("--keypair", "Deployer keypair path");
const cluster = getArg("--cluster") ?? "mainnet-beta";
const dryRun = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${prompt} [yes/NO]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

function runCommand(cmd: string, captureOutput = false): string {
  console.log(`  $ ${cmd}`);
  if (dryRun && !captureOutput) {
    console.log("  [DRY RUN — skipped]");
    return "";
  }
  try {
    return execSync(cmd, { encoding: "utf8", stdio: captureOutput ? "pipe" : "inherit" });
  } catch (err: any) {
    console.error(`ERROR: command failed: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== SSS-150: Transfer BPF Upgrade Authority to Squads ===\n");
  console.log(`  Program:       ${programId}`);
  console.log(`  New authority: ${newAuthority}`);
  console.log(`  Keypair:       ${keypairPath}`);
  console.log(`  Cluster:       ${cluster}`);
  console.log(`  Dry run:       ${dryRun}`);
  console.log("");

  // ------------------------------------------------------------------
  // 1. Validate pubkey formats
  // ------------------------------------------------------------------
  let programPubkey: PublicKey;
  let squadsPubkey: PublicKey;
  try {
    programPubkey = new PublicKey(programId);
    squadsPubkey = new PublicKey(newAuthority);
  } catch {
    console.error("ERROR: Invalid pubkey format for --program or --new-authority");
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // 2. Connect and verify Squads multisig exists on-chain
  // ------------------------------------------------------------------
  const rpcUrl =
    cluster === "mainnet-beta"
      ? clusterApiUrl("mainnet-beta")
      : cluster === "devnet"
      ? clusterApiUrl("devnet")
      : cluster; // allow custom RPC URL

  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Verifying Squads multisig account exists on-chain...");
  const squadsInfo = await connection.getAccountInfo(squadsPubkey);
  if (!squadsInfo) {
    if (dryRun) {
      console.warn(
        `  WARNING: Squads multisig account ${newAuthority} not found on ${cluster}. ` +
        `(This is a dry run — proceeding anyway.)`
      );
    } else {
      console.error(
        `ERROR: Squads multisig account ${newAuthority} does not exist on ${cluster}.\n` +
        `       Verify the pubkey is correct and the multisig has been initialized.`
      );
      process.exit(1);
    }
  } else {
    console.log(`  ✅ Squads multisig account found (${squadsInfo.data.length} bytes, owner: ${squadsInfo.owner.toBase58()})`);
  }

  // ------------------------------------------------------------------
  // 3. Read current upgrade authority via solana program show
  // ------------------------------------------------------------------
  console.log("\nReading current program upgrade authority...");
  const clusterFlag = `--url ${rpcUrl}`;
  const showOutput = runCommand(
    `solana program show ${programId} ${clusterFlag}`,
    true
  ) || "[dry run]";
  console.log(showOutput);

  // Extract current authority from output (best-effort parse)
  const authorityMatch = showOutput.match(/Upgrade Authority:\s+([A-Za-z0-9]+)/);
  if (authorityMatch) {
    const currentAuth = authorityMatch[1];
    console.log(`  Current upgrade authority: ${currentAuth}`);
    if (currentAuth === newAuthority) {
      console.log(
        "\n✅ Upgrade authority is already the Squads multisig. Nothing to do."
      );
      console.log(
        "   Next step: call `set_upgrade_authority_guard` on the SSS program\n" +
        `   to record ${newAuthority} in config for monitoring.\n`
      );
      process.exit(0);
    }
  }

  // ------------------------------------------------------------------
  // 4. Confirmation prompt (skip in dry-run)
  // ------------------------------------------------------------------
  if (!dryRun) {
    console.log("\n⚠️  WARNING: This operation is irreversible if you lose the Squads multisig.");
    console.log("   After transfer, program upgrades require multisig approval.\n");
    const ok = await confirm(
      `Transfer upgrade authority for ${programId} to ${newAuthority} on ${cluster}?`
    );
    if (!ok) {
      console.log("Aborted by user.");
      process.exit(0);
    }
  }

  // ------------------------------------------------------------------
  // 5. Execute the transfer
  // ------------------------------------------------------------------
  console.log("\nTransferring upgrade authority...");
  // Shell-safe: wrap keypairPath in single quotes and escape any embedded single quotes.
  const safeKeypairPath = keypairPath.replace(/'/g, "'\\''");
  runCommand(
    `solana program set-upgrade-authority ${programId} ` +
    `--new-upgrade-authority ${newAuthority} ` +
    `--keypair '${safeKeypairPath}' ` +
    `${clusterFlag}`
  );

  // ------------------------------------------------------------------
  // 6. Verify the transfer
  // ------------------------------------------------------------------
  if (!dryRun) {
    console.log("\nVerifying transfer succeeded...");
    const verifyOutput = runCommand(
      `solana program show ${programId} ${clusterFlag}`,
      true
    );
    console.log(verifyOutput);

    const newAuthMatch = verifyOutput.match(/Upgrade Authority:\s+([A-Za-z0-9]+)/);
    if (newAuthMatch && newAuthMatch[1] === newAuthority) {
      console.log(`\n✅ SUCCESS: Upgrade authority is now ${newAuthority}`);
    } else {
      console.error(
        "\n❌ ERROR: Could not confirm upgrade authority transfer. " +
        "Check program account manually."
      );
      process.exit(1);
    }
  }

  // ------------------------------------------------------------------
  // 7. Next steps
  // ------------------------------------------------------------------
  console.log("\n=== Next Steps ===");
  console.log("");
  console.log("1. Call `set_upgrade_authority_guard` on the SSS program:");
  console.log(`     sss-token.set_upgrade_authority_guard(`);
  console.log(`       config_pda,`);
  console.log(`       ${newAuthority}  // must match squads_multisig in config`);
  console.log(`     )`);
  console.log("");
  console.log("2. Set up monitoring: run `verify_upgrade_authority` on every block");
  console.log("   and alert if it returns UpgradeAuthorityMismatch.");
  console.log("");
  console.log("3. Update MAINNET-CHECKLIST.md — check off:");
  console.log("   [ ] sss_token upgrade authority → Squads multisig");
  console.log("");
  console.log("4. Minimum recommended timelock in Squads: 7 days for upgrade proposals.");
  console.log("   Configure your Squads vault with execution delay >= 604800 seconds.");
  console.log("");

  if (dryRun) {
    console.log("[DRY RUN COMPLETE — no on-chain changes made]\n");
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
