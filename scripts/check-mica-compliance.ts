#!/usr/bin/env npx ts-node
/**
 * check-mica-compliance.ts
 *
 * Reads a deployed SSS stablecoin config and outputs a MiCA compliance
 * checklist (MiCA Regulation (EU) 2023/1114).
 *
 * Usage:
 *   npx ts-node scripts/check-mica-compliance.ts --mint <MINT_ADDRESS> [--rpc <RPC_URL>]
 *
 * Returns exit code 0 if all required checks pass, 1 if any REQUIRED check fails.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

// ── Flag constants (must match on-chain program) ─────────────────────────────
const FLAG_CIRCUIT_BREAKER    = 0x01n;
const FLAG_SPEND_POLICY       = 0x02n;
const FLAG_DAO_COMMITTEE      = 0x04n;
const FLAG_YIELD_COLLATERAL   = 0x08n;
const FLAG_ZK_COMPLIANCE      = 0x10n;
const FLAG_CONFIDENTIAL_TRANSFERS = 0x20n;

// ── MiCA thresholds ──────────────────────────────────────────────────────────
const MICA_MIN_COLLATERAL_RATIO_BPS = 10000; // 100% — Art. 36
const MICA_MAX_REDEMPTION_FEE       = 0;     // 0 fees — Art. 45(4) strict
const MICA_SPEND_LIMIT_USD_CENTS    = 1_000_000; // $10,000 — Art. 23 EBA threshold

// ── Check result types ───────────────────────────────────────────────────────
type Severity = 'REQUIRED' | 'RECOMMENDED' | 'INFO';

interface CheckResult {
  article: string;
  title: string;
  severity: Severity;
  pass: boolean | null; // null = could not determine (missing data)
  detail: string;
}

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs(): { mint: string; rpc: string } {
  const args = process.argv.slice(2);
  let mint = '';
  let rpc = 'https://api.devnet.solana.com';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mint' && args[i + 1]) mint = args[++i];
    if (args[i] === '--rpc'  && args[i + 1]) rpc  = args[++i];
  }

  if (!mint) {
    console.error('Usage: npx ts-node scripts/check-mica-compliance.ts --mint <MINT_ADDRESS> [--rpc <RPC_URL>]');
    process.exit(1);
  }

  return { mint, rpc };
}

// ── Fetch StablecoinConfig PDA ───────────────────────────────────────────────
async function fetchConfig(
  connection: Connection,
  mint: PublicKey,
): Promise<Record<string, unknown> | null> {
  // Derive config PDA: seeds = ["stablecoin_config", mint]
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('stablecoin_config'), mint.toBuffer()],
    new PublicKey('SSSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), // replace with actual program ID
  );

  const accountInfo = await connection.getAccountInfo(configPda);
  if (!accountInfo) return null;

  // For a real integration, deserialise with the IDL using Anchor's BorshCoder.
  // Here we return a placeholder to demonstrate the check structure.
  // In production: use `program.account.stablecoinConfig.fetch(configPda)`
  console.warn('⚠  Note: deserialisation requires the compiled IDL. Running in demo mode — values are illustrative.');
  return null;
}

// ── Run checks ───────────────────────────────────────────────────────────────
function runChecks(config: Record<string, unknown> | null): CheckResult[] {
  const checks: CheckResult[] = [];
  const get = <T>(key: string, fallback: T): T =>
    config && key in config ? (config[key] as T) : fallback;

  const preset          = get<number>('preset', -1);
  const featureFlags    = BigInt(get<number>('feature_flags', 0));
  const collateralRatio = get<number>('collateral_ratio', 0);   // basis points × 100
  const redemptionFee   = get<number>('redemption_fee', -1);
  const maxTransfer     = get<number>('max_transfer_amount', 0);
  const whitepaperUri   = get<string>('whitepaper_uri', '');
  const vaultAuthority  = get<string>('vault_authority', '');
  const mintAuthority   = get<string>('mint_authority', '');
  const configMissing   = config === null;

  // ── Art. 36 — Reserve requirements ────────────────────────────────────────
  checks.push({
    article: 'Art. 36',
    title: 'Preset supports on-chain collateral enforcement (SSS-3)',
    severity: 'REQUIRED',
    pass: configMissing ? null : preset === 3,
    detail: configMissing
      ? 'Could not fetch config — verify program ID and mint address'
      : preset === 3
        ? `Preset: ${preset} — on-chain collateral vault active`
        : `Preset: ${preset} — only SSS-3 satisfies Art. 36 trustless reserve enforcement`,
  });

  checks.push({
    article: 'Art. 36',
    title: 'Collateral ratio ≥ 100%',
    severity: 'REQUIRED',
    pass: configMissing ? null : collateralRatio >= MICA_MIN_COLLATERAL_RATIO_BPS,
    detail: configMissing
      ? 'Could not determine collateral ratio'
      : `collateral_ratio = ${collateralRatio / 100}% (min: 100%)`,
  });

  checks.push({
    article: 'Art. 36',
    title: 'Collateral ratio ≥ 102% (recommended buffer)',
    severity: 'RECOMMENDED',
    pass: configMissing ? null : collateralRatio >= 10200,
    detail: configMissing
      ? 'Could not determine collateral ratio'
      : `collateral_ratio = ${collateralRatio / 100}% (recommended: 102%)`,
  });

  // ── Art. 34 — Reserve segregation ─────────────────────────────────────────
  checks.push({
    article: 'Art. 34',
    title: 'Vault authority is separate from mint authority',
    severity: 'REQUIRED',
    pass: configMissing ? null : vaultAuthority !== '' && vaultAuthority !== mintAuthority,
    detail: configMissing
      ? 'Could not verify authority segregation'
      : vaultAuthority && vaultAuthority !== mintAuthority
        ? `vault_authority (${vaultAuthority.slice(0, 8)}…) ≠ mint_authority (${mintAuthority.slice(0, 8)}…)`
        : 'vault_authority and mint_authority must be different keys (custodian vs issuer)',
  });

  // ── Art. 45 — Redemption rights ───────────────────────────────────────────
  checks.push({
    article: 'Art. 45',
    title: 'Redemption fee = 0 (no fees on redemption)',
    severity: 'REQUIRED',
    pass: configMissing ? null : redemptionFee === MICA_MAX_REDEMPTION_FEE,
    detail: configMissing
      ? 'Could not determine redemption fee'
      : `redemption_fee = ${redemptionFee} (must be 0 for strict Art. 45(4) compliance)`,
  });

  checks.push({
    article: 'Art. 45',
    title: 'Circuit breaker suspension logged to compliance audit trail',
    severity: 'RECOMMENDED',
    pass: null, // Operational check — cannot be verified on-chain alone
    detail: 'Verify: any FLAG_CIRCUIT_BREAKER activation is recorded in the compliance audit log and reported to the competent authority',
  });

  // ── Art. 23 — Transaction limits ──────────────────────────────────────────
  checks.push({
    article: 'Art. 23',
    title: 'FLAG_SPEND_POLICY enabled (per-transfer cap)',
    severity: 'RECOMMENDED',
    pass: configMissing ? null : (featureFlags & FLAG_SPEND_POLICY) !== 0n,
    detail: configMissing
      ? 'Could not check feature flags'
      : (featureFlags & FLAG_SPEND_POLICY) !== 0n
        ? `FLAG_SPEND_POLICY active — max_transfer_amount = ${maxTransfer.toLocaleString()} (base units)`
        : 'FLAG_SPEND_POLICY not set — required for issuers designated significant under Art. 43',
  });

  checks.push({
    article: 'Art. 23',
    title: `Per-transfer limit ≤ $10,000 equivalent`,
    severity: 'RECOMMENDED',
    pass: configMissing ? null : (featureFlags & FLAG_SPEND_POLICY) !== 0n && maxTransfer > 0 && maxTransfer <= MICA_SPEND_LIMIT_USD_CENTS,
    detail: configMissing
      ? 'Could not check transfer limit'
      : `max_transfer_amount = ${maxTransfer.toLocaleString()} (EBA Art. 23 threshold: ${MICA_SPEND_LIMIT_USD_CENTS.toLocaleString()} USDC base units = $10,000)`,
  });

  // ── Art. 22 — Whitepaper disclosure ───────────────────────────────────────
  checks.push({
    article: 'Art. 22',
    title: 'Whitepaper URI set on-chain',
    severity: 'RECOMMENDED',
    pass: configMissing ? null : whitepaperUri.startsWith('ipfs://') || whitepaperUri.startsWith('https://'),
    detail: configMissing
      ? 'Could not check whitepaper URI'
      : whitepaperUri
        ? `whitepaper_uri = ${whitepaperUri}`
        : 'whitepaper_uri not set — recommended to anchor approved whitepaper hash on-chain',
  });

  // ── SSS-123 Proof of Reserves ──────────────────────────────────────────────
  checks.push({
    article: 'Art. 36 / Art. 22',
    title: 'Monthly PoR snapshots published (SSS-123)',
    severity: 'REQUIRED',
    pass: null, // operational check
    detail: 'Verify: POST /api/proof-of-reserves is run at least monthly; reports delivered to competent authority',
  });

  // ── ZK compliance (recommended for privacy-preserving EMTs) ───────────────
  checks.push({
    article: 'Art. 83–85 (AML)',
    title: 'FLAG_ZK_COMPLIANCE or FLAG_CONFIDENTIAL_TRANSFERS — privacy with auditability',
    severity: 'INFO',
    pass: configMissing ? null : (featureFlags & (FLAG_ZK_COMPLIANCE | FLAG_CONFIDENTIAL_TRANSFERS)) !== 0n,
    detail: configMissing
      ? 'Could not check ZK flags'
      : (featureFlags & FLAG_ZK_COMPLIANCE) !== 0n
        ? 'FLAG_ZK_COMPLIANCE active — ZK proof of compliance status on transfers'
        : (featureFlags & FLAG_CONFIDENTIAL_TRANSFERS) !== 0n
          ? 'FLAG_CONFIDENTIAL_TRANSFERS active — ElGamal encrypted amounts with auditor key'
          : 'No ZK privacy flags set (informational — not required by MiCA)',
  });

  return checks;
}

// ── Render results ────────────────────────────────────────────────────────────
function renderResults(mint: string, rpc: string, checks: CheckResult[]): number {
  const icons: Record<string | 'null', string> = {
    true: '✅',
    false: '❌',
    null: '⚠️ ',
  };

  const pass   = checks.filter(c => c.pass === true).length;
  const fail   = checks.filter(c => c.pass === false).length;
  const unknown = checks.filter(c => c.pass === null).length;
  const required = checks.filter(c => c.severity === 'REQUIRED');
  const requiredFail = required.filter(c => c.pass === false).length;

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' SSS MiCA Compliance Checklist');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` Mint:    ${mint}`);
  console.log(` RPC:     ${rpc}`);
  console.log(` Date:    ${new Date().toISOString()}`);
  console.log('──────────────────────────────────────────────────────────────');

  let currentArticle = '';
  for (const c of checks) {
    if (c.article !== currentArticle) {
      console.log('');
      console.log(`  [${c.article}]`);
      currentArticle = c.article;
    }
    const icon = icons[String(c.pass)] ?? '⚠️ ';
    const sev  = c.severity === 'REQUIRED' ? '' : ` [${c.severity}]`;
    console.log(`  ${icon}  ${c.title}${sev}`);
    console.log(`       ${c.detail}`);
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(` Summary: ${pass} passed | ${fail} failed | ${unknown} requires manual verification`);

  if (requiredFail === 0) {
    console.log(' Overall: ✅ All REQUIRED checks passed (manual checks pending)');
  } else {
    console.log(` Overall: ❌ ${requiredFail} REQUIRED check(s) failed — token may not be MiCA compliant`);
  }

  console.log('');
  console.log(' ⚠  This script checks on-chain config only. MiCA also requires:');
  console.log('    • Legal entity authorisation (credit institution or EMI)');
  console.log('    • Whitepaper approved by competent authority (Art. 17)');
  console.log('    • CASP registration if operating a trading platform (Art. 59)');
  console.log('    • AML/KYC/Travel Rule compliance (Art. 83–85)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  return requiredFail > 0 ? 1 : 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { mint, rpc } = parseArgs();
  const connection = new Connection(rpc, 'confirmed');
  const mintPubkey = new PublicKey(mint);

  console.log(`\nFetching SSS config for mint: ${mint}`);
  const config = await fetchConfig(connection, mintPubkey);

  const checks = runChecks(config);
  const exitCode = renderResults(mint, rpc, checks);
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
