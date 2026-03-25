#!/usr/bin/env ts-node
/**
 * check-genius-compliance.ts — SSS-148 GENIUS Act Compliance Checker
 *
 * Verifies that a deployed SSS stablecoin mint is configured in compliance
 * with the GENIUS Act (US payment stablecoin framework, Q3 2026 enforcement).
 *
 * Usage:
 *   npx ts-node scripts/check-genius-compliance.ts --mint <MINT_PUBKEY>
 *   npx ts-node scripts/check-genius-compliance.ts --mint <MINT_PUBKEY> --rpc https://api.mainnet-beta.solana.com
 *
 * Exit codes:
 *   0  — All required checks pass (may have warnings)
 *   1  — One or more required checks FAILED
 *   2  — Configuration error / invalid arguments
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as process from 'process';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
};
const pass  = (t: string) => `${C.green}✅ PASS${C.reset}  ${t}`;
const fail  = (t: string) => `${C.red}❌ FAIL${C.reset}  ${t}`;
const warn  = (t: string) => `${C.yellow}⚠️  WARN${C.reset}  ${t}`;
const info  = (t: string) => `${C.cyan}ℹ️  INFO${C.reset}  ${t}`;
const bold  = (t: string) => `${C.bold}${t}${C.reset}`;
const dim   = (t: string) => `${C.dim}${t}${C.reset}`;

// ─── Feature flag bitmask constants (mirrors state.rs) ───────────────────────

const FLAGS = {
  FLAG_CIRCUIT_BREAKER:    1n << 0n,
  FLAG_SPEND_POLICY:       1n << 1n,
  FLAG_DAO_COMMITTEE:      1n << 2n,
  FLAG_TRAVEL_RULE:        1n << 6n,
  FLAG_SANCTIONS_ORACLE:   1n << 7n,
  FLAG_ZK_CREDENTIALS:     1n << 8n,
  FLAG_WALLET_RATE_LIMITS: 1n << 12n,
  FLAG_SQUADS_AUTHORITY:   1n << 13n,
  FLAG_POR_HALT_ON_BREACH: 1n << 16n,
  FLAG_BRIDGE_ENABLED:     1n << 17n,
};

function hasFlag(featureFlags: bigint, flag: bigint): boolean {
  return (featureFlags & flag) !== 0n;
}

// ─── Check result types ───────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  message: string;
  detail?: string;
  geniusSection?: string;
}

// ─── Simulated config fetch (replace with actual PDA deserialization) ─────────

/**
 * In production: derive the StablecoinConfig PDA and deserialize the account data.
 * This stub returns a typed object for illustration; adapt to your actual Anchor IDL.
 */
async function fetchStablecoinConfig(connection: Connection, mint: PublicKey): Promise<{
  featureFlags: bigint;
  maxSupply: bigint;
  circulatingSupply: bigint;
  reserveAmount: bigint;
  reserveVault: PublicKey;
  squadsMultisig: PublicKey;
  sanctionsOracleEndpoint: string;
  lastAttestationTs: number;
  travelRuleThresholdUsd: number;
  minterCap: bigint;
} | null> {
  // Derive StablecoinConfig PDA
  const [configPda] = await PublicKey.findProgramAddress(
    [Buffer.from('stablecoin_config'), mint.toBuffer()],
    new PublicKey(process.env.SSS_PROGRAM_ID || 'SSSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  );

  const accountInfo = await connection.getAccountInfo(configPda);
  if (!accountInfo) return null;

  // Stub deserialization — replace with Anchor `program.account.stablecoinConfig.fetch(configPda)`
  // Layout (illustrative, matches state.rs):
  const data = accountInfo.data;
  const featureFlags = data.readBigUInt64LE(8);   // skip 8-byte discriminator
  const maxSupply    = data.readBigUInt64LE(16);
  const circulating  = data.readBigUInt64LE(24);
  const reserveAmt   = data.readBigUInt64LE(32);
  const reserveVault = new PublicKey(data.slice(40, 72));
  const squadsKey    = new PublicKey(data.slice(72, 104));
  const lastAttest   = data.readUInt32LE(104);
  const travelThresh = data.readUInt32LE(108);
  const minterCap    = data.readBigUInt64LE(112);

  // Sanctions endpoint: variable-length string at offset 120
  const endpointLen = data.readUInt32LE(120);
  const endpoint    = data.slice(124, 124 + endpointLen).toString('utf-8');

  return {
    featureFlags,
    maxSupply: maxSupply,
    circulatingSupply: circulating,
    reserveAmount: reserveAmt,
    reserveVault,
    squadsMultisig: squadsKey,
    sanctionsOracleEndpoint: endpoint,
    lastAttestationTs: lastAttest,
    travelRuleThresholdUsd: travelThresh,
    minterCap,
  };
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkFlag(
  featureFlags: bigint,
  flagBit: bigint,
  flagName: string,
  required: boolean,
  geniusSection: string,
  description: string,
): CheckResult {
  const enabled = hasFlag(featureFlags, flagBit);
  if (required) {
    return {
      name: flagName,
      status: enabled ? 'pass' : 'fail',
      message: enabled
        ? `${flagName} enabled — ${description}`
        : `${flagName} DISABLED — required for GENIUS compliance`,
      geniusSection,
    };
  } else {
    return {
      name: flagName,
      status: enabled ? 'pass' : 'warn',
      message: enabled
        ? `${flagName} enabled — ${description}`
        : `${flagName} not enabled — recommended for GENIUS compliance`,
      geniusSection,
    };
  }
}

function checkReserveRatio(reserve: bigint, circulating: bigint): CheckResult {
  if (circulating === 0n) {
    return { name: 'reserve_ratio', status: 'info', message: 'No circulating supply — reserve ratio N/A', geniusSection: '§4(a)' };
  }
  const ratio = Number(reserve) / Number(circulating);
  const pct = (ratio * 100).toFixed(2);
  return {
    name: 'reserve_ratio',
    status: ratio >= 1.0 ? 'pass' : 'fail',
    message: ratio >= 1.0
      ? `Reserve ratio ${pct}% — meets 1:1 backing requirement`
      : `Reserve ratio ${pct}% — BELOW 1:1 (GENIUS §4(a) violation!)`,
    geniusSection: '§4(a)',
  };
}

function checkMaxSupply(maxSupply: bigint): CheckResult {
  return {
    name: 'max_supply',
    status: maxSupply > 0n ? 'pass' : 'fail',
    message: maxSupply > 0n
      ? `max_supply = ${maxSupply.toLocaleString()} (capped)`
      : 'max_supply = 0 (UNCAPPED) — footgun; set explicit cap for production',
    geniusSection: '§4(a)',
  };
}

function checkReserveVault(vault: PublicKey): CheckResult {
  const defaultKey = '11111111111111111111111111111111';
  const isSet = vault.toBase58() !== defaultKey;
  return {
    name: 'reserve_vault',
    status: isSet ? 'pass' : 'fail',
    message: isSet
      ? `Reserve vault set: ${vault.toBase58().slice(0, 16)}…`
      : 'Reserve vault is system program (not set!) — must be dedicated keypair',
    geniusSection: '§4(a)',
  };
}

function checkSquadsMultisig(squads: PublicKey, connection: Connection): CheckResult {
  // Sync check — async version would verify account exists on-chain
  const defaultKey = '11111111111111111111111111111111';
  const isSet = squads.toBase58() !== defaultKey;
  return {
    name: 'squads_multisig',
    status: isSet ? 'pass' : 'fail',
    message: isSet
      ? `Squads multisig set: ${squads.toBase58().slice(0, 16)}…`
      : 'Squads multisig is system program (not configured!) — required for §7 custody',
    geniusSection: '§7',
  };
}

function checkAttestationFreshness(lastTs: number): CheckResult {
  if (lastTs === 0) {
    return { name: 'attestation_freshness', status: 'warn', message: 'No attestation on record — submit first attestation before going live', geniusSection: '§4(c)' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const ageDays = (nowSec - lastTs) / 86400;
  const GENIUS_MAX_DAYS = 35; // 10 business days ~ 14 calendar; use 35 for generous bound
  return {
    name: 'attestation_freshness',
    status: ageDays <= GENIUS_MAX_DAYS ? 'pass' : 'fail',
    message: ageDays <= GENIUS_MAX_DAYS
      ? `Last attestation ${ageDays.toFixed(1)} days ago — within 35-day window`
      : `Last attestation ${ageDays.toFixed(1)} days ago — OVERDUE (GENIUS §4(c) violation)`,
    geniusSection: '§4(c)',
  };
}

function checkSanctionsEndpoint(endpoint: string): CheckResult {
  const isSet = endpoint.length > 0 && endpoint.startsWith('https://');
  return {
    name: 'sanctions_oracle_endpoint',
    status: isSet ? 'pass' : 'fail',
    message: isSet
      ? `Sanctions oracle endpoint configured: ${endpoint.replace(/^https:\/\//, '').split('/')[0]}`
      : 'Sanctions oracle endpoint not configured — required for OFAC/AML screening',
    geniusSection: '§5',
  };
}

function checkTravelRule(threshold: number, featureFlags: bigint): CheckResult {
  const travelEnabled = hasFlag(featureFlags, FLAGS.FLAG_TRAVEL_RULE);
  if (!travelEnabled) {
    return { name: 'travel_rule', status: 'fail', message: 'Travel Rule flag disabled — required for GENIUS §5 AML compliance', geniusSection: '§5' };
  }
  if (threshold === 0 || threshold > 3000) {
    return { name: 'travel_rule', status: 'warn', message: `Travel Rule threshold $${threshold} — US GENIUS Act uses $3,000 threshold`, geniusSection: '§5' };
  }
  return { name: 'travel_rule', status: 'pass', message: `Travel Rule enabled at $${threshold} threshold — meets GENIUS §5`, geniusSection: '§5' };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mintIdx = args.indexOf('--mint');
  const rpcIdx  = args.indexOf('--rpc');

  if (mintIdx === -1 || !args[mintIdx + 1]) {
    console.error('Usage: check-genius-compliance.ts --mint <MINT_PUBKEY> [--rpc <URL>]');
    process.exit(2);
  }

  const mintStr = args[mintIdx + 1];
  const rpcUrl  = rpcIdx !== -1 ? args[rpcIdx + 1] : (process.env.SSS_RPC || 'https://api.devnet.solana.com');

  let mint: PublicKey;
  try {
    mint = new PublicKey(mintStr);
  } catch {
    console.error(`Invalid mint public key: ${mintStr}`);
    process.exit(2);
  }

  console.log(`\n${bold('SSS GENIUS Act Compliance Checker')}`);
  console.log(dim('─'.repeat(60)));
  console.log(`Mint:    ${mintStr}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log(`Date:    ${new Date().toISOString()}`);
  console.log(dim('─'.repeat(60)));

  const connection = new Connection(rpcUrl, 'confirmed');

  const config = await fetchStablecoinConfig(connection, mint);
  if (!config) {
    console.error(fail('StablecoinConfig PDA not found — is this a valid SSS mint?'));
    process.exit(1);
  }

  const results: CheckResult[] = [
    // §4(a) Reserve requirements
    checkFlag(config.featureFlags, FLAGS.FLAG_POR_HALT_ON_BREACH, 'FLAG_POR_HALT_ON_BREACH', true, '§4(a)', 'halts minting on reserve breach'),
    checkMaxSupply(config.maxSupply),
    checkReserveVault(config.reserveVault),
    checkReserveRatio(config.reserveAmount, config.circulatingSupply),

    // §4(c) Attestation
    checkAttestationFreshness(config.lastAttestationTs),

    // §4(d) Freeze/seize/burn — circuit breaker is the on-chain emergency halt
    checkFlag(config.featureFlags, FLAGS.FLAG_CIRCUIT_BREAKER, 'FLAG_CIRCUIT_BREAKER', true, '§4(d)', 'emergency pause capability'),

    // §5 AML/BSA
    checkSanctionsEndpoint(config.sanctionsOracleEndpoint),
    checkFlag(config.featureFlags, FLAGS.FLAG_SANCTIONS_ORACLE, 'FLAG_SANCTIONS_ORACLE', true, '§5', 'OFAC sanctions screening on transfers'),
    checkTravelRule(config.travelRuleThresholdUsd, config.featureFlags),

    // §7 Key custody
    checkFlag(config.featureFlags, FLAGS.FLAG_SQUADS_AUTHORITY, 'FLAG_SQUADS_AUTHORITY', true, '§7', 'Squads V4 multisig admin authority'),
    checkSquadsMultisig(config.squadsMultisig, connection),

    // Recommended (warnings)
    checkFlag(config.featureFlags, FLAGS.FLAG_ZK_CREDENTIALS, 'FLAG_ZK_CREDENTIALS', false, '§5 (recommended)', 'privacy-preserving KYC'),
    checkFlag(config.featureFlags, FLAGS.FLAG_WALLET_RATE_LIMITS, 'FLAG_WALLET_RATE_LIMITS', false, '§5 (recommended)', 'per-wallet rate limiting'),
  ];

  let failures = 0;
  let warnings = 0;

  for (const r of results) {
    const section = r.geniusSection ? dim(` [GENIUS ${r.geniusSection}]`) : '';
    switch (r.status) {
      case 'pass': console.log(pass(r.message) + section); break;
      case 'fail': console.log(fail(r.message) + section); failures++; break;
      case 'warn': console.log(warn(r.message) + section); warnings++; break;
      case 'info': console.log(info(r.message) + section); break;
    }
    if (r.detail) console.log(dim(`         ${r.detail}`));
  }

  console.log(dim('─'.repeat(60)));

  if (failures === 0) {
    console.log(`\n${C.green}${C.bold}✅ GENIUS ACT COMPLIANCE: PASS${C.reset}  (${warnings} warning(s))\n`);
    console.log(dim('Note: Technical compliance only. Legal entity, licensing, and'));
    console.log(dim('regulatory approval requirements are outside this checker\'s scope.\n'));
    process.exit(0);
  } else {
    console.log(`\n${C.red}${C.bold}❌ GENIUS ACT COMPLIANCE: FAIL${C.reset}  (${failures} failure(s), ${warnings} warning(s))\n`);
    console.log(dim('Fix all FAIL items before issuing tokens to US holders.\n'));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
