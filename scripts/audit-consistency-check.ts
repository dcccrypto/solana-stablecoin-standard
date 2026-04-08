/**
 * SSS On-Chain Consistency Audit
 *
 * Cross-references instruction handlers, mod.rs declarations, lib.rs wiring,
 * pause checks, circuit breaker guards, Squads enforcement, token account
 * constraints, checked arithmetic usage, and event emissions to surface bugs
 * and dead code.
 *
 * Usage:
 *   npx ts-node scripts/audit-consistency-check.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROG_DIR = path.resolve(__dirname, '../programs/sss-token/src');
const INST_DIR = path.join(PROG_DIR, 'instructions');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function heading(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let issues = 0;
let warnings = 0;

function error(msg: string): void {
  console.log(`  [ERROR] ${msg}`);
  issues++;
}

function warn(msg: string): void {
  console.log(`  [WARN]  ${msg}`);
  warnings++;
}

function ok(msg: string): void {
  console.log(`  [OK]    ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('');
console.log('==========================================================');
console.log('          SSS On-Chain Consistency Audit');
console.log('==========================================================');

// ---------------------------------------------------------------------------
// 1. mod.rs <-> instruction files
// ---------------------------------------------------------------------------
heading('1. mod.rs declarations vs instruction files');

const modRsContent = readFileOrNull(path.join(INST_DIR, 'mod.rs'));
if (!modRsContent) {
  error('Could not read instructions/mod.rs');
  process.exit(2);
}

// Match both `pub mod foo;` at top-level and inline `pub mod foo;` (e.g. after
// a blank line or after a `pub use` block).
const declaredMods = [...modRsContent.matchAll(/pub\s+mod\s+(\w+)\s*;/g)].map(
  (m) => m[1],
);

const instFiles = fs
  .readdirSync(INST_DIR)
  .filter((f) => f.endsWith('.rs') && f !== 'mod.rs')
  .map((f) => f.replace('.rs', ''));

let modFileIssues = 0;

for (const mod of declaredMods) {
  if (!instFiles.includes(mod)) {
    error(`mod.rs declares '${mod}' but no ${mod}.rs file exists`);
    modFileIssues++;
  }
}

for (const file of instFiles) {
  if (!declaredMods.includes(file)) {
    error(`${file}.rs exists but is NOT declared in mod.rs (dead code)`);
    modFileIssues++;
  }
}

if (modFileIssues === 0) {
  ok(`All ${declaredMods.length} mod.rs declarations match instruction files`);
}

// ---------------------------------------------------------------------------
// 2. lib.rs handler wiring
// ---------------------------------------------------------------------------
heading('2. lib.rs handler wiring vs instruction files');

const libRsContent = readFileOrNull(path.join(PROG_DIR, 'lib.rs'));
if (!libRsContent) {
  error('Could not read lib.rs');
  process.exit(2);
}

// Collect every `instructions::xxx::yyy(` call in lib.rs — the module name
// and the function name.
const libCallRe = /instructions::(\w+)::(\w+)\s*\(/g;
const wiredModules = new Set<string>();
const wiredHandlers = new Set<string>();

for (const m of libRsContent.matchAll(libCallRe)) {
  wiredModules.add(m[1]);
  wiredHandlers.add(`${m[1]}::${m[2]}`);
}

let wiringIssues = 0;

// For each instruction module, find all public handler functions and check
// they are referenced in lib.rs.
for (const mod of declaredMods) {
  const content = readFileOrNull(path.join(INST_DIR, `${mod}.rs`));
  if (!content) continue;

  // Match `pub fn some_handler(` — handler functions typically end with
  // `_handler` or match the module name.  We look for ANY public fn.
  const pubFns = [
    ...content.matchAll(/pub\s+fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g),
  ].map((m) => m[1]);

  // Filter to handler-like functions (skip helper fns that start with _).
  const handlers = pubFns.filter(
    (fn) =>
      !fn.startsWith('_') &&
      (fn.includes('handler') ||
        fn === mod ||
        // Also catch functions that are directly called from lib.rs
        wiredHandlers.has(`${mod}::${fn}`)),
  );

  for (const handler of handlers) {
    if (!wiredHandlers.has(`${mod}::${handler}`)) {
      warn(
        `${mod}.rs exports '${handler}' but it is not called from lib.rs (possibly dead)`,
      );
      wiringIssues++;
    }
  }

  // Also check that the module itself is referenced at least once in lib.rs.
  if (!wiredModules.has(mod)) {
    warn(`Module '${mod}' is declared in mod.rs but never referenced in lib.rs`);
    wiringIssues++;
  }
}

if (wiringIssues === 0) {
  ok('All instruction handlers are wired up in lib.rs');
}

// ---------------------------------------------------------------------------
// 3. Pause flag checks on mutating instructions
// ---------------------------------------------------------------------------
heading('3. Pause flag checks on state-mutating instructions');

const mutatingInstructions = [
  'mint',
  'burn',
  'redeem',
  'deposit_collateral',
  'cdp_borrow_stable',
  'cdp_deposit_collateral',
  'cdp_repay_stable',
  'cpi_mint',
  'cpi_burn',
  'bridge',
  'market_maker',
];

let pauseIssues = 0;
for (const inst of mutatingInstructions) {
  const filePath = path.join(INST_DIR, `${inst}.rs`);
  const content = readFileOrNull(filePath);
  if (!content) {
    warn(`${inst}.rs not found — skipping pause check`);
    continue;
  }
  // Look for any reference to paused state: field access, error variant, or require! macro
  const checksPause =
    content.includes('paused') ||
    content.includes('Paused') ||
    content.includes('FLAG_PAUSE') ||
    content.includes('is_paused');
  if (!checksPause) {
    warn(`${inst}.rs does not appear to check paused state`);
    pauseIssues++;
  }
}

if (pauseIssues === 0) {
  ok('All mutating instructions check pause state');
}

// ---------------------------------------------------------------------------
// 4. Circuit breaker checks on mint/burn paths
// ---------------------------------------------------------------------------
heading('4. Circuit breaker checks on mint/burn paths');

const cbInstructions = [
  'mint',
  'burn',
  'redeem',
  'cpi_mint',
  'cpi_burn',
  'bridge',
  'cdp_borrow_stable',
  'market_maker',
];

let cbIssues = 0;
for (const inst of cbInstructions) {
  const filePath = path.join(INST_DIR, `${inst}.rs`);
  const content = readFileOrNull(filePath);
  if (!content) continue;
  const checksCircuitBreaker =
    content.includes('FLAG_CIRCUIT_BREAKER') ||
    content.includes('CircuitBreakerActive') ||
    content.includes('circuit_breaker') ||
    content.includes('FLAG_CIRCUIT_BREAKER_ENABLED');
  if (!checksCircuitBreaker) {
    warn(`${inst}.rs does not check FLAG_CIRCUIT_BREAKER`);
    cbIssues++;
  }
}

if (cbIssues === 0) {
  ok('All mint/burn paths check circuit breaker');
}

// ---------------------------------------------------------------------------
// 5. Squads authority enforcement on authority-gated instructions
// ---------------------------------------------------------------------------
heading('5. Squads authority enforcement');

const authorityGated = [
  'update_roles',
  'update_minter',
  'revoke_minter',
  'pause',
  'admin_timelock',
  'feature_flags',
  'oracle_config',
  'spend_policy',
  'collateral_config',
  'guardian',
];

let squadsIssues = 0;
for (const inst of authorityGated) {
  const filePath = path.join(INST_DIR, `${inst}.rs`);
  const content = readFileOrNull(filePath);
  if (!content) continue;
  const checksSquads =
    content.includes('verify_squads_signer') ||
    content.includes('FLAG_SQUADS_AUTHORITY') ||
    content.includes('squads_authority') ||
    content.includes('SquadsAuthority');
  if (!checksSquads) {
    warn(`${inst}.rs is authority-gated but does not check Squads enforcement`);
    squadsIssues++;
  }
}

if (squadsIssues === 0) {
  ok('All authority-gated instructions check Squads enforcement');
}

// ---------------------------------------------------------------------------
// 6. Token account mint constraints
// ---------------------------------------------------------------------------
heading('6. Token account mint constraints');

let mintConstraintIssues = 0;
for (const file of instFiles) {
  const content = readFileOrNull(path.join(INST_DIR, `${file}.rs`));
  if (!content) continue;

  // Find InterfaceAccount<'info, TokenAccount> fields
  const tokenAccountRe =
    /pub\s+(\w+)\s*:\s*(?:InterfaceAccount|Account)<'info,\s*TokenAccount>/g;
  const matches = [...content.matchAll(tokenAccountRe)];

  for (const [, name] of matches) {
    // Skip common vault/escrow accounts that are PDA-derived and implicitly
    // constrained by seeds.
    if (/escrow|vault|reserve|pool|insurance/i.test(name)) continue;

    // Check for a mint constraint — either in an Anchor #[account(...)] attribute
    // or in handler logic.
    const hasMintConstraint =
      content.includes(`${name}.mint`) ||
      // Anchor constraint syntax: `constraint = ... .mint ...`
      new RegExp(`#\\[account\\([^)]*${name}[^)]*mint\\s*=`, 's').test(content) ||
      // token::mint = ... on the account declaration
      new RegExp(`token::mint\\s*=`, 's').test(
        // Grab the attribute block above this field
        content.slice(
          Math.max(0, content.indexOf(`pub ${name}`) - 300),
          content.indexOf(`pub ${name}`),
        ),
      );

    if (!hasMintConstraint) {
      warn(`${file}.rs::${name} (TokenAccount) may be missing mint constraint`);
      mintConstraintIssues++;
    }
  }
}

if (mintConstraintIssues === 0) {
  ok('All token accounts appear to have mint constraints');
}

// ---------------------------------------------------------------------------
// 7. .unwrap() on checked arithmetic
// ---------------------------------------------------------------------------
heading('7. Checked arithmetic .unwrap() usage');

let unwrapIssues = 0;
for (const file of instFiles) {
  const content = readFileOrNull(path.join(INST_DIR, `${file}.rs`));
  if (!content) continue;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detect checked_op(...).unwrap() on a single line
    if (/checked_(add|sub|mul|div)\s*\([^)]*\)\s*\.unwrap\(\)/.test(line)) {
      warn(`${file}.rs:${i + 1} — .unwrap() on checked arithmetic (use ok_or with error)`);
      unwrapIssues++;
    }
  }
}

if (unwrapIssues === 0) {
  ok('No .unwrap() on checked arithmetic found');
}

// ---------------------------------------------------------------------------
// 8. Unchecked raw arithmetic operators
// ---------------------------------------------------------------------------
heading('8. Raw arithmetic operators (potential overflow)');

let rawArithIssues = 0;
for (const file of instFiles) {
  const content = readFileOrNull(path.join(INST_DIR, `${file}.rs`));
  if (!content) continue;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*') || line.trimStart().startsWith('///')) continue;
    // Skip lines that are just use/mod statements
    if (/^\s*(use |pub use |pub mod |mod )/.test(line)) continue;

    // Look for raw arithmetic on numeric-looking expressions:
    //   something + something, something - something, etc.
    // But exclude string concatenation, lifetimes ('a + 'b), and comments.
    // Focus on patterns like `amount + fee`, `x * y` with identifiers/numbers.
    // This is intentionally conservative to reduce false positives.
    if (
      /\b(amount|total|balance|supply|debt|collateral|fee|price|ratio|cap|limit|minted|burned|remaining|accrued)\b\s*[\+\-\*](?!\s*>)\s*\b\w+/.test(line) &&
      !line.includes('checked_') &&
      !line.includes('saturating_') &&
      !line.includes('//') &&
      !line.includes('assert')
    ) {
      warn(`${file}.rs:${i + 1} — possible unchecked arithmetic: ${line.trim().slice(0, 80)}`);
      rawArithIssues++;
    }
  }
}

if (rawArithIssues === 0) {
  ok('No suspicious raw arithmetic detected');
}

// ---------------------------------------------------------------------------
// 9. Event emission coverage
// ---------------------------------------------------------------------------
heading('9. Event emission coverage');

const eventsRsContent = readFileOrNull(path.join(PROG_DIR, 'events.rs'));
if (!eventsRsContent) {
  warn('Could not read events.rs — skipping event checks');
} else {
  const definedEvents = [
    ...eventsRsContent.matchAll(/pub\s+struct\s+(\w+)\s*\{/g),
  ].map((m) => m[1]);

  // Gather all instruction file contents + lib.rs for emit checks
  const allInstContent = instFiles
    .map((f) => readFileOrNull(path.join(INST_DIR, `${f}.rs`)) ?? '')
    .join('\n');

  // Also check other source files (some events are emitted from non-instruction code)
  const otherSrcFiles = ['lib.rs', 'state.rs']
    .map((f) => readFileOrNull(path.join(PROG_DIR, f)) ?? '')
    .join('\n');

  const allContent = allInstContent + '\n' + otherSrcFiles;

  let eventIssues = 0;
  const emittedEvents: string[] = [];
  const unemittedEvents: string[] = [];

  for (const event of definedEvents) {
    // Check for emit!(EventName { ... }) or emit!(EventName{...})
    if (
      allContent.includes(`emit!(${event}`) ||
      allContent.includes(`emit!(${event} `)
    ) {
      emittedEvents.push(event);
    } else {
      unemittedEvents.push(event);
      warn(`Event '${event}' defined in events.rs but never emitted`);
      eventIssues++;
    }
  }

  if (eventIssues === 0) {
    ok(`All ${definedEvents.length} events are emitted`);
  } else {
    console.log(
      `  [INFO]  ${emittedEvents.length}/${definedEvents.length} events are emitted`,
    );
  }
}

// ---------------------------------------------------------------------------
// 10. Duplicate PDA seeds (potential collision)
// ---------------------------------------------------------------------------
heading('10. PDA seed uniqueness');

// Collect (seed_expr, file) pairs where the seeds appear inside an `init`
// account attribute block.  We look for `#[account( ... init ... seeds = [...]`
// within the same attribute to distinguish actual PDA creation from references.
const initSeedMap = new Map<string, string[]>();
let pdaIssues = 0;

for (const file of instFiles) {
  const content = readFileOrNull(path.join(INST_DIR, `${file}.rs`));
  if (!content) continue;

  // Match entire #[account(...)] attribute blocks (may span multiple lines).
  const accountAttrRe = /#\[account\(([\s\S]*?)\)\]/g;
  for (const attrMatch of content.matchAll(accountAttrRe)) {
    const attrBody = attrMatch[1];
    // Only care about init accounts
    if (!/\binit\b/.test(attrBody)) continue;
    // Extract the seeds expression
    const seedsMatch = attrBody.match(/seeds\s*=\s*\[([^\]]+)\]/);
    if (!seedsMatch) continue;
    // Exclude the StablecoinConfig PDA itself — it is referenced (not init'd)
    // in nearly every instruction via `has_one` or `seeds` for validation.
    const seedExpr = seedsMatch[1].replace(/\s+/g, ' ').trim();
    if (/^StablecoinConfig::SEED/.test(seedExpr)) continue;

    const existing = initSeedMap.get(seedExpr) ?? [];
    existing.push(file);
    initSeedMap.set(seedExpr, existing);
  }
}

for (const [seeds, files] of initSeedMap.entries()) {
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.length > 1) {
    warn(
      `PDA seeds [${seeds}] init'd in multiple files: ${uniqueFiles.join(', ')}`,
    );
    pdaIssues++;
  }
}

if (pdaIssues === 0) {
  ok('No suspicious duplicate PDA seed patterns found');
}

// ---------------------------------------------------------------------------
// 11. Access control — authority signer checks
// ---------------------------------------------------------------------------
heading('11. Authority signer verification');

let signerIssues = 0;
for (const file of instFiles) {
  const content = readFileOrNull(path.join(INST_DIR, `${file}.rs`));
  if (!content) continue;

  // Find structs that have an `authority` field
  if (content.includes('pub authority') || content.includes('pub admin')) {
    // Check that the authority account is marked as a Signer
    const hasSignerCheck =
      content.includes("Signer<'info>") ||
      content.includes('has_one = authority') ||
      content.includes('has_one = admin') ||
      // Some patterns use constraint-based checks
      content.includes('authority.key()') ||
      content.includes('admin.key()');

    if (!hasSignerCheck) {
      warn(`${file}.rs has authority/admin field but may be missing Signer constraint`);
      signerIssues++;
    }
  }
}

if (signerIssues === 0) {
  ok('All authority fields appear to have signer checks');
}

// ---------------------------------------------------------------------------
// 12. Close account drain checks
// ---------------------------------------------------------------------------
heading('12. Account close destination checks');

let closeIssues = 0;
for (const file of instFiles) {
  const content = readFileOrNull(path.join(INST_DIR, `${file}.rs`));
  if (!content) continue;

  // Look for close = ... in account attributes
  const closeRe = /close\s*=\s*(\w+)/g;
  for (const m of content.matchAll(closeRe)) {
    const destination = m[1];
    // The close destination should ideally be authority or the account owner,
    // not an arbitrary account.
    if (
      destination !== 'authority' &&
      destination !== 'admin' &&
      destination !== 'payer' &&
      destination !== 'owner' &&
      destination !== 'issuer' &&
      destination !== 'initiator' &&
      destination !== 'redeemer'
    ) {
      warn(
        `${file}.rs closes account to '${destination}' — verify this is the correct rent recipient`,
      );
      closeIssues++;
    }
  }
}

if (closeIssues === 0) {
  ok('All account close destinations look reasonable');
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log('');
console.log('==========================================================');
console.log('  SUMMARY');
console.log('==========================================================');
console.log(`  Instruction files:  ${instFiles.length}`);
console.log(`  mod.rs modules:     ${declaredMods.length}`);
console.log(`  Errors:             ${issues}`);
console.log(`  Warnings:           ${warnings}`);
console.log('==========================================================');

if (issues > 0) {
  console.log(`\n  Result: FAIL (${issues} errors, ${warnings} warnings)\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\n  Result: PASS with ${warnings} warnings\n`);
  process.exit(0);
} else {
  console.log('\n  Result: PASS (clean)\n');
  process.exit(0);
}
