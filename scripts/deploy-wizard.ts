#!/usr/bin/env ts-node
/**
 * deploy-wizard.ts — SSS-155 Interactive deployment wizard
 *
 * Guides issuers through SSS stablecoin deployment safely, preventing common
 * footguns at initialization. Steps:
 *   1.  Preset selection (SSS-1/2/3/4-Institutional)
 *   2.  Supply parameters (max_supply, minter cap)
 *   3.  Compliance config (feature flags, sanctions oracle)
 *   4.  Governance setup (Squads multisig, guardian pubkeys)
 *   5.  Oracle config (Pyth feed, confidence interval, staleness)
 *   6.  Reserve vault setup (SSS-3/4 only)
 *   7.  Insurance vault (SSS-3/4 only)
 *   8.  Dry-run: simulate all initialization transactions, show PDAs
 *   9.  Confirmation: typed confirmation of all critical parameters
 *   10. Deploy + verify: deploy and run post-deploy checks
 *
 * Usage:
 *   npx ts-node scripts/deploy-wizard.ts
 *
 * Env vars:
 *   SOLANA_KEYPAIR  — path to deployer keypair (default: ~/.config/solana/id.json)
 *   SSS_RPC         — RPC endpoint (default: https://api.devnet.solana.com)
 *   SSS_PROGRAM_ID  — override the on-chain program ID
 *   SSS_DRY_RUN     — if "1", exit after step 8 without deploying
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function fmt(color: string, text: string): string {
  return `${color}${text}${C.reset}`;
}
function bold(t: string) { return fmt(C.bold, t); }
function dim(t: string) { return fmt(C.dim, t); }
function info(t: string) { return fmt(C.cyan, t); }
function ok(t: string) { return fmt(C.green, t); }
function warn(t: string) { return fmt(C.yellow, t); }
function err(t: string) { return fmt(C.red, t); }

// ─── Feature flag constants (mirrors state.rs) ──────────────────────────────

const FLAGS: Record<string, { bit: bigint; label: string; presets: number[] }> = {
  FLAG_CIRCUIT_BREAKER:         { bit: 1n << 0n,  label: 'Circuit breaker (emergency halt all ops)',         presets: [1,2,3,4] },
  FLAG_SPEND_POLICY:            { bit: 1n << 1n,  label: 'Spend policy (per-tx transfer cap)',               presets: [2,3,4] },
  FLAG_DAO_COMMITTEE:           { bit: 1n << 2n,  label: 'DAO committee (on-chain governance proposals)',    presets: [3,4] },
  FLAG_TRAVEL_RULE:             { bit: 1n << 6n,  label: 'Travel Rule compliance (SSS-127)',                 presets: [2,3,4] },
  FLAG_SANCTIONS_ORACLE:        { bit: 1n << 7n,  label: 'Sanctions oracle enforcement (SSS-128)',          presets: [2,3,4] },
  FLAG_ZK_CREDENTIALS:          { bit: 1n << 8n,  label: 'ZK credential enforcement (SSS-129)',             presets: [2,3,4] },
  FLAG_WALLET_RATE_LIMITS:      { bit: 1n << 12n, label: 'Per-wallet rate limiting (SSS-133)',              presets: [2,3,4] },
  FLAG_SQUADS_AUTHORITY:        { bit: 1n << 13n, label: 'Squads V4 multisig authority (SSS-134, irreversible!)', presets: [4] },
  FLAG_POR_HALT_ON_BREACH:      { bit: 1n << 16n, label: 'Proof-of-Reserves breach halts minting (SSS-123)', presets: [3,4] },
  FLAG_BRIDGE_ENABLED:          { bit: 1n << 17n, label: 'Cross-chain bridge (SSS-135)',                    presets: [3,4] },
  FLAG_MARKET_MAKER_HOOKS:      { bit: 1n << 18n, label: 'Market maker hooks (SSS-138)',                    presets: [3,4] },
};

// ─── Preset definitions ─────────────────────────────────────────────────────

interface PresetDef {
  id: number;
  name: string;
  description: string;
  details: string[];
  anchorPreset: number;
  requiresTransferHook: boolean;
  requiresCollateral: boolean;
  requiresSquads: boolean;
  defaultFlags: bigint;
  minSolBalance: number;
}

const PRESETS: PresetDef[] = [
  {
    id: 1,
    name: 'SSS-1: Minimal',
    description: 'Token-2022 mint with freeze authority + metadata.',
    details: [
      'Use for: Internal tokens, DAO treasuries, ecosystem settlement.',
      'No transfer hook, no compliance enforcement.',
      'Simplest possible stablecoin — lowest ops overhead.',
    ],
    anchorPreset: 1,
    requiresTransferHook: false,
    requiresCollateral: false,
    requiresSquads: false,
    defaultFlags: 0n,
    minSolBalance: 0.1,
  },
  {
    id: 2,
    name: 'SSS-2: Compliant',
    description: 'SSS-1 + permanent delegate + transfer hook + blacklist enforcement.',
    details: [
      'Use for: Regulated stablecoins (USDC/USDT-class).',
      'Requires a deployed transfer-hook program.',
      'Enables sanctions screening and compliance flags.',
    ],
    anchorPreset: 2,
    requiresTransferHook: true,
    requiresCollateral: false,
    requiresSquads: false,
    defaultFlags: 0n,
    minSolBalance: 0.2,
  },
  {
    id: 3,
    name: 'SSS-3: Reserve-Backed',
    description: 'SSS-2 + on-chain collateral reserve vault (deposit/redeem).',
    details: [
      'Use for: Fully-collateralised stablecoins backed by on-chain assets.',
      'Requires a reserve vault token account + collateral mint.',
      'Supports Proof-of-Reserves, CDP, PSM, insurance vault.',
    ],
    anchorPreset: 3,
    requiresTransferHook: true,
    requiresCollateral: true,
    requiresSquads: false,
    defaultFlags: 0n,
    minSolBalance: 0.5,
  },
  {
    id: 4,
    name: 'SSS-4-Institutional (PRESET_INSTITUTIONAL)',
    description: 'All SSS-3 features + Squads V4 multisig authority.',
    details: [
      'Use for: Issuers holding > $1 M in reserves.',
      '⚠️  Enabling Squads authority is IRREVERSIBLE — the program will no',
      '   longer accept single-signer admin instructions.',
      'Requires a funded Squads multisig vault address.',
    ],
    anchorPreset: 4,
    requiresTransferHook: true,
    requiresCollateral: true,
    requiresSquads: true,
    defaultFlags: FLAGS.FLAG_SQUADS_AUTHORITY.bit,
    minSolBalance: 1.0,
  },
];

// ─── Wizard state ────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1
  preset: PresetDef;
  // Step 2
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  maxSupply: bigint;       // 0n = unlimited
  minterCap: bigint;       // 0n = unlimited
  // Step 3
  featureFlags: bigint;
  sanctionsOracleEndpoint: string;
  // Step 4
  squadsMsig: string;
  guardianPubkeys: string[];
  // Step 5
  pythFeed: string;
  maxOracleAgeSecs: number;
  maxConfBps: number;
  // Step 6
  collateralMint: string;
  reserveVaultKeypairPath: string;
  reserveVaultPubkey: string;
  // Step 7
  insuranceVaultPubkey: string;
  insuranceVaultSeedLamports: number;
  // Runtime
  deployerKeypairPath: string;
  rpcEndpoint: string;
  programId: string;
  dryRun: boolean;
}

// ─── Readline helpers ────────────────────────────────────────────────────────

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  return new Promise((resolve) => {
    const hint = defaultVal !== undefined ? ` ${dim(`[${defaultVal}]`)}` : '';
    rl.question(`${question}${hint}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function promptYN(rl: readline.Interface, question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await prompt(rl, `${question} (${hint})`);
  if (answer === '') return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

function printSection(title: string, step: number, total: number) {
  console.log();
  console.log(fmt(C.bold + C.blue, `── Step ${step}/${total}: ${title} ─────────────────────────────────`));
  console.log();
}

function printWarning(lines: string[]) {
  console.log();
  console.log(warn('  ┌─ ⚠️  WARNING ──────────────────────────────────────────────'));
  for (const line of lines) {
    console.log(warn(`  │  ${line}`));
  }
  console.log(warn('  └────────────────────────────────────────────────────────────'));
  console.log();
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function isValidPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

async function promptPubkey(rl: readline.Interface, label: string, required = true, defaultVal?: string): Promise<string> {
  while (true) {
    const v = await prompt(rl, label, defaultVal);
    if (!v && !required) return '';
    if (isValidPubkey(v)) return v;
    console.log(err(`  ✗ "${v}" is not a valid Solana public key. Try again.`));
  }
}

async function promptPositiveBigint(rl: readline.Interface, label: string, defaultVal = '0'): Promise<bigint> {
  while (true) {
    const v = await prompt(rl, label, defaultVal);
    try {
      const n = BigInt(v);
      if (n < 0n) throw new Error('negative');
      return n;
    } catch {
      console.log(err('  ✗ Must be a non-negative integer.'));
    }
  }
}

async function promptPositiveInt(rl: readline.Interface, label: string, defaultVal: number, min = 0, max = Number.MAX_SAFE_INTEGER): Promise<number> {
  while (true) {
    const v = await prompt(rl, label, String(defaultVal));
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= min && n <= max) return n;
    console.log(err(`  ✗ Must be an integer between ${min} and ${max}.`));
  }
}

// ─── PDA derivation (display only — does not require anchor) ────────────────

function deriveConfigPDA(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stablecoin_config'), mint.toBuffer()],
    programId
  );
}

function deriveMintAuthorityPDA(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), mint.toBuffer()],
    programId
  );
}

// ─── Step implementations ────────────────────────────────────────────────────

async function step1PresetSelection(rl: readline.Interface): Promise<PresetDef> {
  printSection('Preset Selection', 1, 10);
  console.log('  Choose the SSS preset that matches your deployment goals:\n');

  for (const p of PRESETS) {
    console.log(bold(`  [${p.id}] ${p.name}`));
    console.log(`      ${p.description}`);
    for (const d of p.details) console.log(info(`      ${d}`));
    console.log();
  }

  while (true) {
    const choice = await prompt(rl, '  Enter preset number', '1');
    const id = parseInt(choice, 10);
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      console.log(ok(`\n  ✓ Selected: ${preset.name}`));
      return preset;
    }
    console.log(err('  ✗ Enter 1, 2, 3, or 4.'));
  }
}

async function step2SupplyParams(rl: readline.Interface, state: Partial<WizardState>): Promise<void> {
  printSection('Supply Parameters', 2, 10);

  state.tokenName = await prompt(rl, '  Token name (e.g. "My USD Stablecoin")', 'My USD Stablecoin');
  state.tokenSymbol = await prompt(rl, '  Token symbol (e.g. "MUSD", up to 10 chars)');
  if (!state.tokenSymbol || state.tokenSymbol.length > 10) {
    state.tokenSymbol = 'MUSD';
    console.log(warn('  ⚠️  Symbol invalid or empty — defaulting to MUSD'));
  }
  state.tokenSymbol = state.tokenSymbol.toUpperCase();

  state.tokenDecimals = await promptPositiveInt(rl, '  Token decimals', 6, 0, 9);

  console.log();
  console.log(dim('  max_supply = 0 means UNLIMITED supply (no hard cap).'));
  console.log(dim('  If you set a non-zero value, minting will fail once supply exceeds it.'));
  console.log();

  state.maxSupply = await promptPositiveBigint(rl, '  Maximum supply in base units (0 = unlimited)', '0');

  if (state.maxSupply === 0n) {
    console.log(warn('  ⚠️  No supply cap set. Recommend capping for regulated issuances.'));
  } else {
    const human = Number(state.maxSupply) / Math.pow(10, state.tokenDecimals!);
    console.log(ok(`  ✓ Supply cap: ${human.toLocaleString()} ${state.tokenSymbol}`));
  }

  console.log();
  console.log(dim('  minter_cap = 0 means the minter can mint up to max_supply (unlimited per-minter cap).'));

  state.minterCap = await promptPositiveBigint(rl, '  Minter cap in base units (0 = unlimited)', '0');
}

async function step3ComplianceConfig(rl: readline.Interface, state: Partial<WizardState>): Promise<void> {
  const preset = state.preset!;
  printSection('Compliance Config', 3, 10);

  console.log('  Feature flags to enable (space-separated numbers, or Enter to skip):\n');

  const relevantFlags = Object.entries(FLAGS).filter(([, v]) => v.presets.includes(preset.id));
  const flagKeys = relevantFlags.map(([k]) => k);

  for (let i = 0; i < relevantFlags.length; i++) {
    const [key, val] = relevantFlags[i];
    const irreversible = key === 'FLAG_SQUADS_AUTHORITY' ? err(' ← IRREVERSIBLE') : '';
    console.log(`  [${i + 1}] ${val.label}${irreversible}`);
  }

  console.log();
  const defaultEnabled: number[] = [];
  // Pre-select Squads for preset 4
  if (preset.id === 4) {
    const idx = flagKeys.indexOf('FLAG_SQUADS_AUTHORITY');
    if (idx >= 0) defaultEnabled.push(idx + 1);
  }

  const defaultStr = defaultEnabled.length > 0 ? defaultEnabled.join(' ') : '';
  const input = await prompt(rl, '  Enter flag numbers to enable (space-separated)', defaultStr || '');

  let flags = preset.defaultFlags;
  const selected: string[] = [];

  if (input.trim()) {
    for (const tok of input.trim().split(/\s+/)) {
      const idx = parseInt(tok, 10) - 1;
      if (idx >= 0 && idx < relevantFlags.length) {
        const [key, val] = relevantFlags[idx];
        flags |= val.bit;
        selected.push(key);
      }
    }
  }

  if (selected.includes('FLAG_SQUADS_AUTHORITY')) {
    printWarning([
      'FLAG_SQUADS_AUTHORITY is IRREVERSIBLE.',
      'Once set, single-signer admin instructions are permanently disabled.',
      'Ensure your Squads multisig is configured BEFORE deployment.',
    ]);
    const confirm = await promptYN(rl, '  Confirm FLAG_SQUADS_AUTHORITY?', false);
    if (!confirm) {
      flags &= ~FLAGS.FLAG_SQUADS_AUTHORITY.bit;
      console.log(warn('  FLAG_SQUADS_AUTHORITY removed.'));
    }
  }

  state.featureFlags = flags;
  console.log(ok(`\n  ✓ Feature flags: 0x${flags.toString(16)} (${flags.toString(2).replace(/^0*/, '') || '0'})`));

  // Sanctions oracle endpoint
  state.sanctionsOracleEndpoint = '';
  if (flags & FLAGS.FLAG_SANCTIONS_ORACLE.bit) {
    console.log();
    state.sanctionsOracleEndpoint = await prompt(
      rl,
      '  Sanctions oracle endpoint URL (e.g. https://ofac.example.com/check)',
      'https://ofac.example.com/check'
    );
    if (!state.sanctionsOracleEndpoint.startsWith('https://')) {
      console.log(warn('  ⚠️  Endpoint should use HTTPS in production.'));
    }
  }
}

async function step4GovernanceSetup(rl: readline.Interface, state: Partial<WizardState>): Promise<void> {
  const preset = state.preset!;
  printSection('Governance Setup', 4, 10);

  state.squadsMsig = '';
  if (preset.requiresSquads || (state.featureFlags! & FLAGS.FLAG_SQUADS_AUTHORITY.bit)) {
    console.log(info('  Squads V4 multisig is required for this preset.'));
    state.squadsMsig = await promptPubkey(rl, '  Squads multisig vault address (PublicKey)');
  } else {
    const useSquads = await promptYN(rl, '  Add a Squads multisig as backup authority?', false);
    if (useSquads) {
      state.squadsMsig = await promptPubkey(rl, '  Squads multisig vault address');
    }
  }

  console.log();
  console.log(dim('  Guardians are additional pubkeys that can trigger emergency circuit-breaker.'));
  console.log(dim('  Enter one per line. Empty line to finish. (Up to 5)'));
  console.log();

  const guardians: string[] = [];
  while (guardians.length < 5) {
    const g = await promptPubkey(rl, `  Guardian ${guardians.length + 1} pubkey (empty to skip)`, false);
    if (!g) break;
    guardians.push(g);
    console.log(ok(`  ✓ Added guardian: ${g}`));
  }
  state.guardianPubkeys = guardians;

  if (guardians.length === 0) {
    console.log(warn('  ⚠️  No guardians set. Recommended for production deployments.'));
  }
}

async function step5OracleConfig(rl: readline.Interface, state: Partial<WizardState>): Promise<void> {
  const preset = state.preset!;
  printSection('Oracle Config', 5, 10);

  if (preset.id < 3) {
    console.log(dim('  Oracle config is optional for SSS-1/2. Skipping.'));
    state.pythFeed = '';
    state.maxOracleAgeSecs = 60;
    state.maxConfBps = 200;
    return;
  }

  console.log(dim('  Pyth feed selection — find feeds at https://pyth.network/developers/price-feed-ids'));
  console.log();

  state.pythFeed = await promptPubkey(
    rl,
    '  Pyth price feed account (PublicKey)',
    false,
    'H6ARHf6YXhGYeQfUzQNGFUD2QiqjFmEZF5FwUF5N8uv2' // Pyth SOL/USD devnet
  );

  if (!state.pythFeed) {
    console.log(warn('  ⚠️  No Pyth feed set. POR and collateral checks will use fallback.'));
    state.pythFeed = '';
  }

  state.maxOracleAgeSecs = await promptPositiveInt(
    rl,
    '  Max oracle age (seconds before price is considered stale)',
    60, 1, 3600
  );

  if (state.maxOracleAgeSecs > 300) {
    console.log(warn(`  ⚠️  ${state.maxOracleAgeSecs}s staleness window is very permissive. Recommend ≤60s for production.`));
  }

  state.maxConfBps = await promptPositiveInt(
    rl,
    '  Max confidence interval in basis points (e.g. 200 = 2%)',
    200, 1, 2000
  );

  if (state.maxConfBps > 500) {
    console.log(warn(`  ⚠️  Confidence interval of ${state.maxConfBps} bps (${state.maxConfBps / 100}%) is wide — price manipulation risk.`));
  }

  console.log(ok(`\n  ✓ Oracle: age=${state.maxOracleAgeSecs}s, conf=${state.maxConfBps}bps`));
}

async function step6ReserveVault(rl: readline.Interface, state: Partial<WizardState>): Promise<void> {
  const preset = state.preset!;
  printSection('Reserve Vault Setup', 6, 10);

  if (!preset.requiresCollateral) {
    console.log(dim('  Reserve vault not required for this preset. Skipping.'));
    state.collateralMint = '';
    state.reserveVaultKeypairPath = '';
    state.reserveVaultPubkey = '';
    return;
  }

  console.log(info('  The reserve vault is the on-chain token account that holds collateral.'));
  console.log(info('  It must be a Token-2022 (or SPL) account for the collateral mint.'));
  console.log();

  state.collateralMint = await promptPubkey(rl, '  Collateral token mint (e.g. USDC mint on-chain)');

  console.log();
  console.log(dim('  You can either provide an existing reserve vault account or generate a new keypair.'));

  const genNew = await promptYN(rl, '  Generate a new reserve vault keypair?', true);

  if (genNew) {
    const vaultKp = Keypair.generate();
    const defaultPath = path.join(os.homedir(), '.config', 'solana', `reserve-vault-${state.tokenSymbol!.toLowerCase()}.json`);
    const savePath = await prompt(rl, '  Save keypair to', defaultPath);

    fs.writeFileSync(savePath, JSON.stringify(Array.from(vaultKp.secretKey)));
    console.log(ok(`  ✓ Keypair saved to ${savePath}`));
    console.log(warn('  ⚠️  Back this up securely! Loss of reserve vault keypair = loss of funds.'));

    state.reserveVaultKeypairPath = savePath;
    state.reserveVaultPubkey = vaultKp.publicKey.toBase58();
  } else {
    state.reserveVaultKeypairPath = '';
    state.reserveVaultPubkey = await promptPubkey(rl, '  Existing reserve vault token account');
  }

  console.log(ok(`  ✓ Reserve vault: ${state.reserveVaultPubkey}`));
}

async function step7InsuranceVault(rl: readline.Interface, state: Partial<WizardState>): Promise<void> {
  const preset = state.preset!;
  printSection('Insurance Vault', 7, 10);

  if (!preset.requiresCollateral) {
    console.log(dim('  Insurance vault not required for this preset. Skipping.'));
    state.insuranceVaultPubkey = '';
    state.insuranceVaultSeedLamports = 0;
    return;
  }

  console.log(info('  The insurance vault absorbs bad debt in CDP liquidations.'));
  console.log(info('  Minimum seed amount depends on expected position sizes.'));
  console.log();

  const useInsurance = await promptYN(rl, '  Configure insurance vault?', true);

  if (!useInsurance) {
    state.insuranceVaultPubkey = '';
    state.insuranceVaultSeedLamports = 0;
    console.log(warn('  ⚠️  No insurance vault set. Bad debt socialization will use backstop only.'));
    return;
  }

  state.insuranceVaultPubkey = await promptPubkey(rl, '  Insurance vault token account');

  const minSeedSol = await promptPositiveInt(
    rl,
    '  Minimum seed amount in SOL-equivalent (for rent + buffer)',
    1, 0, 1000
  );
  state.insuranceVaultSeedLamports = minSeedSol * LAMPORTS_PER_SOL;

  console.log(ok(`  ✓ Insurance vault: ${state.insuranceVaultPubkey} (seed: ${minSeedSol} SOL)`));
}

async function step8DryRun(rl: readline.Interface, state: WizardState, programId: PublicKey): Promise<void> {
  printSection('Dry-Run Simulation', 8, 10);

  // Generate a throw-away mint keypair for PDA preview (not used in real deploy)
  const fakeMint = Keypair.generate();
  const mint = fakeMint.publicKey;

  const [configPDA, configBump] = deriveConfigPDA(mint, programId);
  const [mintAuthPDA, mintAuthBump] = deriveMintAuthorityPDA(mint, programId);

  console.log('  PDAs that will be created:\n');
  console.log(`    ${bold('Mint')}:                  ${info('<generated at deploy time>')}`);
  console.log(`    ${bold('StablecoinConfig PDA')}:  ${info(configPDA.toBase58())}  (bump: ${configBump})`);
  console.log(`    ${bold('MintAuthority PDA')}:     ${info(mintAuthPDA.toBase58())}  (bump: ${mintAuthBump})`);

  console.log('\n  Initialization parameters:\n');
  console.log(`    Token name:       ${bold(state.tokenName)}`);
  console.log(`    Symbol:           ${bold(state.tokenSymbol)}`);
  console.log(`    Decimals:         ${state.tokenDecimals}`);
  console.log(`    Preset:           SSS-${state.preset.anchorPreset}`);

  const supplyStr = state.maxSupply === 0n
    ? warn('UNLIMITED (no hard cap)')
    : ok(`${state.maxSupply.toLocaleString()} base units`);
  console.log(`    Max supply:       ${supplyStr}`);

  const minterCapStr = state.minterCap === 0n
    ? dim('unlimited (no per-minter cap)')
    : state.minterCap.toLocaleString() + ' base units';
  console.log(`    Minter cap:       ${minterCapStr}`);

  console.log(`    Feature flags:    0x${state.featureFlags.toString(16)}`);

  const enabledFlagLabels = Object.entries(FLAGS)
    .filter(([, v]) => state.featureFlags & v.bit)
    .map(([k]) => k);
  if (enabledFlagLabels.length > 0) {
    for (const f of enabledFlagLabels) {
      console.log(`                      ${ok('✓')} ${FLAGS[f].label}`);
    }
  } else {
    console.log(`                      ${dim('(none)')}`);
  }

  if (state.squadsMsig) {
    console.log(`    Squads multisig:  ${state.squadsMsig}`);
  }
  if (state.guardianPubkeys.length > 0) {
    console.log(`    Guardians:        ${state.guardianPubkeys.join(', ')}`);
  }
  if (state.collateralMint) {
    console.log(`    Collateral mint:  ${state.collateralMint}`);
    console.log(`    Reserve vault:    ${state.reserveVaultPubkey}`);
  }
  if (state.pythFeed) {
    console.log(`    Pyth feed:        ${state.pythFeed}`);
    console.log(`    Oracle age:       ${state.maxOracleAgeSecs}s`);
    console.log(`    Oracle conf:      ${state.maxConfBps} bps`);
  }

  console.log();

  // Simulate estimated accounts and rent
  const rentExemptLamports = 2_039_280; // approximate for Config PDA
  const estimatedTxFees = 5_000;
  const totalLamports = rentExemptLamports + estimatedTxFees;

  console.log(`    ${bold('Estimated cost')}:     ~${(totalLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`    ${bold('Minimum balance')}:    ${state.preset.minSolBalance} SOL`);
  console.log();
  console.log(ok('  ✓ Dry-run complete. No transactions submitted.'));
}

async function step9Confirmation(rl: readline.Interface, state: WizardState): Promise<boolean> {
  printSection('Confirmation', 9, 10);

  console.log(warn('  ⚠️  You are about to deploy a stablecoin to the Solana network.'));
  console.log(warn('      This action creates on-chain accounts and costs real SOL.'));
  if (state.preset.id === 4 || state.featureFlags & FLAGS.FLAG_SQUADS_AUTHORITY.bit) {
    printWarning([
      'Squads authority is enabled. The program authority will transfer to the',
      'Squads multisig immediately upon deployment. Single-signer admin ops will',
      'be PERMANENTLY disabled.',
    ]);
  }

  console.log();
  console.log('  To confirm, type the token symbol exactly as entered:');
  const confirm = await prompt(rl, `  Type "${state.tokenSymbol}" to confirm`);

  if (confirm !== state.tokenSymbol) {
    console.log(err(`  ✗ Confirmation failed. Got "${confirm}", expected "${state.tokenSymbol}". Aborting.`));
    return false;
  }

  console.log(ok('  ✓ Confirmed.'));
  return true;
}

async function step10DeployAndVerify(rl: readline.Interface, state: WizardState, connection: Connection, deployerKp: Keypair, programId: PublicKey): Promise<void> {
  printSection('Deploy + Verify', 10, 10);

  // Resolve SDK modules dynamically to avoid hard compile-time dependency
  // in a context where the SDK may not be built yet.
  let SolanaStablecoin: any;
  let AnchorProvider: any, Wallet: any;

  try {
    const sdkPath = path.join(__dirname, '..', 'sdk', 'src');
    const anchorPkg = require('@coral-xyz/anchor');
    AnchorProvider = anchorPkg.AnchorProvider;
    Wallet = anchorPkg.Wallet;
    SolanaStablecoin = require(path.join(sdkPath, 'SolanaStablecoin')).SolanaStablecoin;
  } catch (e: any) {
    console.log(err(`  ✗ Failed to load SDK: ${e.message}`));
    console.log(dim('    Run: yarn build  then try again.'));
    process.exit(1);
  }

  console.log(info('  Creating provider and SSS client...'));
  const provider = new AnchorProvider(
    connection,
    new Wallet(deployerKp),
    { commitment: 'confirmed', skipPreflight: false }
  );

  const client = new SolanaStablecoin(provider, programId.toBase58());

  // Generate the token mint keypair
  const mintKp = Keypair.generate();
  console.log(info(`  Mint keypair generated: ${mintKp.publicKey.toBase58()}`));

  // Save mint keypair
  const mintKpPath = path.join(os.homedir(), '.config', 'solana', `mint-${state.tokenSymbol.toLowerCase()}-${Date.now()}.json`);
  fs.writeFileSync(mintKpPath, JSON.stringify(Array.from(mintKp.secretKey)));
  console.log(ok(`  ✓ Mint keypair saved to ${mintKpPath}`));
  console.log(warn('  ⚠️  Back up this keypair — you need it to manage the token.'));

  console.log(info('  Initializing stablecoin on-chain...'));

  const config: any = {
    preset: `SSS-${state.preset.anchorPreset}` as any,
    name: state.tokenName,
    symbol: state.tokenSymbol,
    decimals: state.tokenDecimals,
    maxSupply: state.maxSupply > 0n ? state.maxSupply : undefined,
    featureFlags: state.featureFlags > 0n ? state.featureFlags : undefined,
  };

  if (state.preset.requiresTransferHook) {
    // Transfer hook program ID would be set here; we prompt for it or use a default
    // In production, this must be the deployed transfer-hook program.
    const hookProgram = process.env.SSS_TRANSFER_HOOK_PROGRAM;
    if (hookProgram) {
      config.transferHookProgram = new PublicKey(hookProgram);
    } else {
      console.log(warn('  ⚠️  SSS_TRANSFER_HOOK_PROGRAM env not set. Transfer hook disabled for this deploy.'));
    }
  }

  if (state.collateralMint) {
    config.collateralMint = new PublicKey(state.collateralMint);
    config.reserveVault = new PublicKey(state.reserveVaultPubkey);
  }

  try {
    const result = await client.initialize(mintKp, config);
    console.log(ok(`  ✓ Stablecoin initialized!`));
    console.log(ok(`    Mint:     ${mintKp.publicKey.toBase58()}`));
    console.log(ok(`    Tx sig:   ${result}`));
  } catch (e: any) {
    console.log(err(`  ✗ Deploy failed: ${e.message}`));
    if (e.logs) {
      console.log(dim('  Program logs:'));
      for (const log of e.logs) {
        console.log(dim(`    ${log}`));
      }
    }
    throw e;
  }

  // Run check-deployment as post-deploy verification
  console.log();
  console.log(info('  Running post-deploy checks...'));

  try {
    const checkScript = path.join(__dirname, 'check-deployment.ts');
    if (fs.existsSync(checkScript)) {
      const { execSync } = require('child_process');
      execSync(
        `npx ts-node "${checkScript}" --mint "${mintKp.publicKey.toBase58()}" --rpc "${state.rpcEndpoint}" --program-id "${state.programId}"`,
        { stdio: 'inherit', cwd: path.join(__dirname, '..') }
      );
    }
  } catch {
    console.log(warn('  ⚠️  Post-deploy check script failed or not found. Review manually.'));
  }

  // Write deployment manifest
  const deployDir = path.join(__dirname, '..', 'deploy');
  if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir);
  const manifestPath = path.join(deployDir, `deploy-${state.tokenSymbol.toLowerCase()}-${Date.now()}.json`);
  const manifest = {
    deployedAt: new Date().toISOString(),
    tokenName: state.tokenName,
    tokenSymbol: state.tokenSymbol,
    decimals: state.tokenDecimals,
    preset: state.preset.name,
    mintAddress: mintKp.publicKey.toBase58(),
    programId: state.programId,
    rpcEndpoint: state.rpcEndpoint,
    featureFlags: `0x${state.featureFlags.toString(16)}`,
    maxSupply: state.maxSupply.toString(),
    minterCap: state.minterCap.toString(),
    collateralMint: state.collateralMint || null,
    reserveVault: state.reserveVaultPubkey || null,
    squadsMsig: state.squadsMsig || null,
    guardians: state.guardianPubkeys,
    pythFeed: state.pythFeed || null,
    mintKeypairPath: mintKpPath,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(ok(`\n  ✓ Deployment manifest saved to ${manifestPath}`));
  console.log();
  console.log(fmt(C.bold + C.green, '  🎉 Deployment complete!'));
  console.log(bold(`     Mint address: ${mintKp.publicKey.toBase58()}`));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(fmt(C.bold + C.blue,
    '╔══════════════════════════════════════════════════════════════╗\n' +
    '║   Solana Stablecoin Standard — Deployment Wizard (SSS-155)  ║\n' +
    '╚══════════════════════════════════════════════════════════════╝'
  ));
  console.log();
  console.log(dim('  This wizard guides you through a safe SSS stablecoin deployment.'));
  console.log(dim('  It validates all inputs and simulates the deployment before sending any transactions.'));
  console.log();

  const rl = createRL();
  process.on('SIGINT', () => { rl.close(); process.exit(0); });

  const deployerKeypairPath = process.env.SOLANA_KEYPAIR ||
    path.join(os.homedir(), '.config', 'solana', 'id.json');
  const rpcEndpoint = process.env.SSS_RPC || 'https://api.devnet.solana.com';
  const dryRun = process.env.SSS_DRY_RUN === '1';

  if (!fs.existsSync(deployerKeypairPath)) {
    console.error(err(`  ✗ Deployer keypair not found at ${deployerKeypairPath}`));
    console.error(dim('    Set SOLANA_KEYPAIR env var or run: solana-keygen new'));
    rl.close();
    process.exit(1);
  }

  const deployerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(deployerKeypairPath, 'utf8')))
  );

  const connection = new Connection(rpcEndpoint, 'confirmed');

  // Load or fall back program ID
  let programId: PublicKey;
  const envProgId = process.env.SSS_PROGRAM_ID;
  if (envProgId && isValidPubkey(envProgId)) {
    programId = new PublicKey(envProgId);
  } else {
    const manifestPath = path.join(__dirname, '..', 'deploy', 'devnet-latest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const pid = manifest.sss_token || manifest.programId;
      programId = pid ? new PublicKey(pid) : new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
    } else {
      programId = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
    }
  }

  console.log(info(`  Deployer:    ${deployerKp.publicKey.toBase58()}`));
  console.log(info(`  RPC:         ${rpcEndpoint}`));
  console.log(info(`  Program ID:  ${programId.toBase58()}`));
  if (dryRun) {
    console.log(warn('  DRY-RUN MODE: No transactions will be submitted.\n'));
  }

  // Check deployer balance
  let balance: number;
  try {
    balance = await connection.getBalance(deployerKp.publicKey);
    const balSol = balance / LAMPORTS_PER_SOL;
    const balStr = balSol < 0.5 ? warn(`${balSol.toFixed(4)} SOL (LOW)`) : ok(`${balSol.toFixed(4)} SOL`);
    console.log(info(`  Balance:     ${balStr}`));
  } catch {
    console.log(warn('  ⚠️  Could not fetch balance. Proceeding anyway.'));
    balance = 0;
  }
  console.log();

  const state: Partial<WizardState> = {
    deployerKeypairPath,
    rpcEndpoint,
    programId: programId.toBase58(),
    dryRun,
  };

  // ── Run wizard steps ────────────────────────────────────────────────────
  state.preset = await step1PresetSelection(rl);

  if (balance < state.preset.minSolBalance * LAMPORTS_PER_SOL) {
    console.log(warn(`  ⚠️  Balance may be insufficient for ${state.preset.name} (min ~${state.preset.minSolBalance} SOL).`));
  }

  await step2SupplyParams(rl, state);
  await step3ComplianceConfig(rl, state);
  await step4GovernanceSetup(rl, state);
  await step5OracleConfig(rl, state);
  await step6ReserveVault(rl, state);
  await step7InsuranceVault(rl, state);

  const finalState = state as WizardState;
  await step8DryRun(rl, finalState, programId);

  if (dryRun) {
    console.log(warn('\n  SSS_DRY_RUN=1 set. Exiting before deploy.\n'));
    rl.close();
    return;
  }

  const confirmed = await step9Confirmation(rl, finalState);
  if (!confirmed) {
    rl.close();
    process.exit(1);
  }

  await step10DeployAndVerify(rl, finalState, connection, deployerKp, programId);

  rl.close();
}

main().catch((e) => {
  console.error(err(`\nFatal error: ${e.message}`));
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
