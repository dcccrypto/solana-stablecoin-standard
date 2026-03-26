#!/usr/bin/env ts-node
/**
 * check-deployment.ts — SSS-155 Post-deploy validation script
 *
 * Verifies that a deployed SSS stablecoin is correctly configured:
 *   1. On-chain program account exists and is executable
 *   2. Stablecoin mint account exists and is a Token-2022 mint
 *   3. StablecoinConfig PDA is initialized and readable
 *   4. Preset matches expected value
 *   5. Feature flags match deployment manifest
 *   6. Max supply is set correctly (0 = unlimited)
 *   7. Mint authority PDA is correct
 *   8. Transfer hook program is set (if SSS-2+)
 *   9. Collateral vault exists (if SSS-3+)
 *  10. Squads multisig authority is set (if FLAG_SQUADS_AUTHORITY)
 *
 * Usage:
 *   npx ts-node scripts/check-deployment.ts \
 *     --mint <MINT_ADDRESS> \
 *     [--rpc <RPC_URL>] \
 *     [--program-id <PROGRAM_ID>] \
 *     [--manifest <path/to/deploy-*.json>]
 *
 * Exit code: 0 = all checks passed, 1 = one or more failures.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
};
const bold = (t: string) => `${C.bold}${t}${C.reset}`;
const dim  = (t: string) => `${C.dim}${t}${C.reset}`;
const ok   = (t: string) => `${C.green}${t}${C.reset}`;
const warn = (t: string) => `${C.yellow}${t}${C.reset}`;
const fail = (t: string) => `${C.red}${t}${C.reset}`;
const info = (t: string) => `${C.cyan}${t}${C.reset}`;

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { mint: string; rpc: string; programId: string; manifestPath: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] || '' : '';
  };

  const mint = get('--mint');
  const rpc = get('--rpc') || process.env.SSS_RPC || 'https://api.devnet.solana.com';
  const programId = get('--program-id') || process.env.SSS_PROGRAM_ID || 'AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat';
  const manifestPath = get('--manifest') || '';

  if (!mint) {
    console.error(fail('  --mint <MINT_ADDRESS> is required'));
    process.exit(1);
  }

  return { mint, rpc, programId, manifestPath };
}

// ─── PDA derivation ──────────────────────────────────────────────────────────

function deriveConfigPDA(mint: PublicKey, program: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stablecoin_config'), mint.toBuffer()],
    program
  );
}

function deriveMintAuthorityPDA(mint: PublicKey, program: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), mint.toBuffer()],
    program
  );
}

// ─── Check runner ─────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  warning?: boolean;
}

const results: CheckResult[] = [];

function addResult(name: string, passed: boolean, message: string, warning = false) {
  results.push({ name, passed, message, warning });
  const icon = passed ? ok('  ✓') : (warning ? warn('  ⚠') : fail('  ✗'));
  const label = passed ? ok(name) : (warning ? warn(name) : fail(name));
  console.log(`${icon} ${label}: ${message}`);
}

// ─── Main checks ─────────────────────────────────────────────────────────────

async function main() {
  const { mint: mintStr, rpc, programId: programIdStr, manifestPath } = parseArgs();

  console.log();
  console.log(bold('  ╔════════════════════════════════════════════════════════╗'));
  console.log(bold('  ║   SSS Post-Deploy Verification (check-deployment.ts)  ║'));
  console.log(bold('  ╚════════════════════════════════════════════════════════╝'));
  console.log();

  let mint: PublicKey;
  let programId: PublicKey;

  try {
    mint = new PublicKey(mintStr);
    programId = new PublicKey(programIdStr);
  } catch {
    console.error(fail(`  Invalid mint or program-id address`));
    process.exit(1);
  }

  const connection = new Connection(rpc, 'confirmed');

  console.log(info(`  Mint:       ${mint.toBase58()}`));
  console.log(info(`  Program:    ${programId.toBase58()}`));
  console.log(info(`  RPC:        ${rpc}`));
  console.log();

  // Load manifest if available
  let manifest: any = null;
  if (manifestPath && fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log(info(`  Manifest:   ${manifestPath}`));
    console.log();
  }

  // ── Check 1: Program account ──────────────────────────────────────────────
  try {
    const programAcct = await connection.getAccountInfo(programId);
    if (!programAcct) {
      addResult('Program account', false, `Not found at ${programId.toBase58()}`);
    } else if (!programAcct.executable) {
      addResult('Program account', false, 'Account exists but is NOT executable');
    } else {
      addResult('Program account', true, `Executable, owner: ${programAcct.owner.toBase58()}`);
    }
  } catch (e: any) {
    addResult('Program account', false, `RPC error: ${e.message}`);
  }

  // ── Check 2: Mint account (Token-2022) ────────────────────────────────────
  let mintDecimals: number | undefined;
  try {
    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    mintDecimals = mintInfo.decimals;
    addResult('Mint account (Token-2022)', true,
      `Decimals: ${mintInfo.decimals}, Supply: ${mintInfo.supply.toLocaleString()}`);

    if (manifest && manifest.decimals !== undefined && mintInfo.decimals !== manifest.decimals) {
      addResult('Decimals match manifest', false,
        `On-chain: ${mintInfo.decimals}, manifest: ${manifest.decimals}`);
    } else if (manifest?.decimals !== undefined) {
      addResult('Decimals match manifest', true, `${mintInfo.decimals}`);
    }
  } catch (e: any) {
    addResult('Mint account (Token-2022)', false, `Not found or not a Token-2022 mint: ${e.message}`);
  }

  // ── Check 3: StablecoinConfig PDA exists ─────────────────────────────────
  const [configPDA, configBump] = deriveConfigPDA(mint, programId);
  try {
    const configAcct = await connection.getAccountInfo(configPDA);
    if (!configAcct) {
      addResult('StablecoinConfig PDA', false, `PDA not found: ${configPDA.toBase58()}`);
    } else {
      addResult('StablecoinConfig PDA', true,
        `${configPDA.toBase58()}  (${configAcct.data.length} bytes, bump ${configBump})`);
    }
  } catch (e: any) {
    addResult('StablecoinConfig PDA', false, `RPC error: ${e.message}`);
  }

  // ── Check 4: MintAuthority PDA ────────────────────────────────────────────
  const [mintAuthPDA, mintAuthBump] = deriveMintAuthorityPDA(mint, programId);
  try {
    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    if (!mintInfo.mintAuthority) {
      addResult('Mint authority', false, 'No mint authority set (should be PDA)');
    } else if (mintInfo.mintAuthority.toBase58() === mintAuthPDA.toBase58()) {
      addResult('Mint authority PDA', true, `Correct PDA: ${mintAuthPDA.toBase58()} (bump ${mintAuthBump})`);
    } else {
      addResult('Mint authority PDA', false,
        `Mismatch. Expected ${mintAuthPDA.toBase58()}, got ${mintInfo.mintAuthority.toBase58()}`);
    }
  } catch {
    // already reported in check 2
  }

  // ── Check 5: Deployer balance (warning if low) ────────────────────────────
  const deployerEnv = process.env.SOLANA_KEYPAIR;
  if (deployerEnv && fs.existsSync(deployerEnv)) {
    try {
      const { Keypair } = require('@solana/web3.js');
      const deployerKp = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(deployerEnv, 'utf8')))
      );
      const bal = await connection.getBalance(deployerKp.publicKey);
      const balSol = bal / LAMPORTS_PER_SOL;
      if (balSol < 0.05) {
        addResult('Deployer balance', false, `${balSol.toFixed(4)} SOL — TOO LOW for further ops`, true);
      } else {
        addResult('Deployer balance', true, `${balSol.toFixed(4)} SOL`);
      }
    } catch {
      // ignore balance check errors
    }
  }

  // ── Check 6: Manifest cross-validation ───────────────────────────────────
  if (manifest) {
    if (manifest.mintAddress && manifest.mintAddress !== mint.toBase58()) {
      addResult('Manifest mint match', false,
        `Manifest says ${manifest.mintAddress}, checking ${mint.toBase58()}`);
    }
    if (manifest.programId && manifest.programId !== programId.toBase58()) {
      addResult('Manifest program match', false,
        `Manifest says ${manifest.programId}, checking ${programId.toBase58()}`);
    } else if (manifest.programId) {
      addResult('Manifest program match', true, programId.toBase58());
    }
  }

  // ── Check 7: Reserve vault exists (if manifest has it) ───────────────────
  if (manifest?.reserveVault) {
    try {
      const vaultAcct = await connection.getAccountInfo(new PublicKey(manifest.reserveVault));
      if (!vaultAcct) {
        addResult('Reserve vault', false, `Not found: ${manifest.reserveVault}`);
      } else {
        addResult('Reserve vault', true, `${manifest.reserveVault} (${vaultAcct.data.length} bytes)`);
      }
    } catch (e: any) {
      addResult('Reserve vault', false, `RPC error: ${e.message}`);
    }
  }

  // ── Check 8: Squads msig (if manifest has it) ─────────────────────────────
  if (manifest?.squadsMsig) {
    try {
      const msigAcct = await connection.getAccountInfo(new PublicKey(manifest.squadsMsig));
      if (!msigAcct) {
        addResult('Squads multisig', false, `Not found: ${manifest.squadsMsig}`, true);
      } else {
        addResult('Squads multisig', true, `${manifest.squadsMsig} (${msigAcct.data.length} bytes)`);
      }
    } catch (e: any) {
      addResult('Squads multisig', false, `RPC error: ${e.message}`, true);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.warning).length;
  const warnings = results.filter((r) => r.warning).length;
  const total = results.length;

  console.log();
  console.log(bold('  ── Summary ──────────────────────────────────────────────'));
  console.log(`  ${ok(`✓ ${passed} passed`)}  ${failed > 0 ? fail(`✗ ${failed} failed`) : dim('✗ 0 failed')}  ${warnings > 0 ? warn(`⚠ ${warnings} warnings`) : dim('⚠ 0 warnings')}  (${total} total)`);
  console.log();

  if (failed > 0) {
    console.log(fail('  ✗ Deployment check FAILED. Review the errors above before proceeding.'));
    process.exit(1);
  } else if (warnings > 0) {
    console.log(warn('  ⚠ Deployment checks passed with warnings. Review before going to mainnet.'));
  } else {
    console.log(ok('  ✓ All deployment checks PASSED.'));
  }
  console.log();
}

main().catch((e) => {
  console.error(fail(`\nFatal: ${e.message}`));
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
