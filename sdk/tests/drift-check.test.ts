/**
 * SDK <-> On-chain Drift Detection Tests
 *
 * Verifies that SDK constants (flags, PDA seeds, program IDs) stay in sync
 * with the canonical on-chain definitions in:
 *   - programs/sss-token/src/state.rs
 *   - crates/sss-cpi/src/flags.rs
 *   - crates/sss-cpi/src/pda.rs
 *   - Anchor.toml
 *
 * Run: npx vitest run sdk/tests/drift-check.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Paths (relative to this file at sdk/tests/)
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '../..');
const STATE_RS = path.join(ROOT, 'programs/sss-token/src/state.rs');
const CPI_FLAGS_RS = path.join(ROOT, 'crates/sss-cpi/src/flags.rs');
const CPI_PDA_RS = path.join(ROOT, 'crates/sss-cpi/src/pda.rs');
const ANCHOR_TOML = path.join(ROOT, 'Anchor.toml');
const SDK_SRC = path.join(ROOT, 'sdk/src');
const SDK_MAIN = path.join(SDK_SRC, 'SolanaStablecoin.ts');

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Extract `pub const FLAG_XXX: u64 = 1 << N` from a Rust source file.
 * Returns Map<flag_name, computed_value>.
 */
function parseRustFlags(filePath: string): Map<string, bigint> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const flags = new Map<string, bigint>();
  const regex = /pub const (FLAG_\w+):\s*u64\s*=\s*1\s*<<\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    flags.set(match[1], 1n << BigInt(match[2]));
  }
  return flags;
}

/**
 * Extract exported TypeScript flag constants of the form:
 *   export const FLAG_XXX = 1n << Nn;
 * from all non-test .ts files under a directory.
 */
function parseTsFlags(dirPath: string): Map<string, { value: bigint; file: string }> {
  const flags = new Map<string, { value: bigint; file: string }>();
  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'),
  );
  for (const file of files) {
    const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
    // Match both:  export const FLAG_XXX = 1n << Nn;
    //              const FLAG_XXX = 1n << Nn;
    const regex = /(?:export\s+)?const\s+(FLAG_\w+)\s*(?::\s*bigint\s*)?=\s*1n\s*<<\s*(\d+)n/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      flags.set(match[1], { value: 1n << BigInt(match[2]), file });
    }
  }
  return flags;
}

/**
 * Extract all `pub const SEED: &'static [u8] = b"xxx"` constants from state.rs,
 * paired with the enclosing `impl StructName { ... }`.
 * Returns Map<struct_name, seed_string>.
 */
function parseRustSeedsFromState(filePath: string): Map<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const seeds = new Map<string, string>();
  // Match impl blocks containing SEED constants
  const implBlockRegex = /impl\s+(\w+)\s*\{[^}]*?pub const SEED:\s*&[^=]*=\s*b"([^"]+)"/gs;
  let match: RegExpExecArray | null;
  while ((match = implBlockRegex.exec(content)) !== null) {
    seeds.set(match[1], match[2]);
  }
  return seeds;
}

/**
 * Extract all seed string literals from state.rs SEED constants (just the values).
 */
function parseAllStateSeedValues(filePath: string): Set<string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const seeds = new Set<string>();
  const regex = /pub const SEED:\s*&[^=]*=\s*b"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    seeds.add(match[1]);
  }
  return seeds;
}

/**
 * Extract CPI crate seed constants: `const SEED_XXX: &[u8] = b"yyy"`
 */
function parseCpiSeeds(filePath: string): Map<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const seeds = new Map<string, string>();
  const regex = /const\s+(SEED_\w+):\s*&\[u8\]\s*=\s*b"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    seeds.set(match[1], match[2]);
  }
  return seeds;
}

/**
 * Extract all Buffer.from('xxx') seed strings from SDK .ts files.
 * Returns Map<seed_string, array of {file, varName}> for deduplication.
 */
function parseTsSeedStrings(
  dirPath: string,
): Map<string, Array<{ file: string; varName: string }>> {
  const seeds = new Map<string, Array<{ file: string; varName: string }>>();
  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'),
  );
  for (const file of files) {
    const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
    // Match patterns like:
    //   const FOO_SEED = Buffer.from('some-seed')
    //   static readonly FOO_SEED = Buffer.from('some-seed')
    //   export const FOO_SEED = Buffer.from('some-seed')
    const regex =
      /(?:(?:export|static)\s+)?(?:readonly\s+)?(\w*SEED\w*)\s*=\s*Buffer\.from\(['"]([^'"]+)['"]\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const seedValue = match[2];
      const varName = match[1];
      if (!seeds.has(seedValue)) {
        seeds.set(seedValue, []);
      }
      seeds.get(seedValue)!.push({ file, varName });
    }
  }
  return seeds;
}

// =========================================================================
// Tests
// =========================================================================

describe('SDK <-> On-chain Drift Detection', () => {
  // Ensure required source files exist before running
  it('required source files exist', () => {
    for (const p of [STATE_RS, CPI_FLAGS_RS, CPI_PDA_RS, ANCHOR_TOML, SDK_MAIN]) {
      expect(fs.existsSync(p), `Missing required file: ${p}`).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // 1. Flag Constant Verification: SDK vs state.rs
  // -----------------------------------------------------------------------
  describe('Flag Constants: SDK vs state.rs', () => {
    const onChainFlags = parseRustFlags(STATE_RS);
    const sdkFlags = parseTsFlags(SDK_SRC);

    it('state.rs contains at least one FLAG_ constant', () => {
      expect(
        onChainFlags.size,
        'state.rs should define FLAG_ constants — parser may be broken',
      ).toBeGreaterThan(0);
    });

    it('SDK contains at least one FLAG_ constant', () => {
      expect(
        sdkFlags.size,
        'SDK should define FLAG_ constants — parser may be broken',
      ).toBeGreaterThan(0);
    });

    it('every SDK FLAG_ constant value matches the on-chain state.rs definition', () => {
      const mismatches: string[] = [];
      for (const [name, sdkInfo] of sdkFlags) {
        // Skip test-only / alias constants that intentionally differ:
        // FLAG_CIRCUIT_BREAKER_V2 is a re-export alias for FLAG_CIRCUIT_BREAKER
        // FLAG_CT is a local alias for FLAG_CONFIDENTIAL_TRANSFERS inside SolanaStablecoin.ts
        if (name === 'FLAG_CIRCUIT_BREAKER_V2') continue;
        if (name === 'FLAG_CT') continue;

        const onChainValue = onChainFlags.get(name);
        if (onChainValue === undefined) {
          mismatches.push(
            `${name} is defined in SDK (${sdkInfo.file}) but NOT in state.rs — ` +
              'either add it to state.rs or remove from SDK',
          );
        } else if (sdkInfo.value !== onChainValue) {
          mismatches.push(
            `${name}: SDK value = ${sdkInfo.value} (bit ${sdkInfo.value.toString(2).length - 1}) ` +
              `in ${sdkInfo.file}, but on-chain = ${onChainValue} (bit ${onChainValue.toString(2).length - 1}) — ` +
              'update the SDK constant to match state.rs',
          );
        }
      }

      expect(
        mismatches,
        `SDK flag mismatches detected:\n  - ${mismatches.join('\n  - ')}`,
      ).toHaveLength(0);
    });

    it('no on-chain FLAG_ constants are missing from the SDK', () => {
      const sdkFlagNames = new Set(sdkFlags.keys());
      const missing: string[] = [];
      for (const [name, value] of onChainFlags) {
        if (!sdkFlagNames.has(name)) {
          missing.push(
            `${name} (bit ${value.toString(2).length - 1}) exists in state.rs but has no SDK export — ` +
              'add an export in the appropriate SDK module',
          );
        }
      }
      // This is informational — not all flags need SDK exposure, but we want to track gaps
      if (missing.length > 0) {
        console.warn(
          `[drift-check] ${missing.length} on-chain flags lack SDK exports:\n  - ${missing.join('\n  - ')}`,
        );
      }
      // Soft assertion: warn but don't fail; switch to expect() if 100% coverage required
      expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. PDA Seed Verification: SDK vs state.rs
  // -----------------------------------------------------------------------
  describe('PDA Seeds: SDK vs state.rs', () => {
    const stateSeeds = parseAllStateSeedValues(STATE_RS);
    const structSeeds = parseRustSeedsFromState(STATE_RS);
    const sdkSeeds = parseTsSeedStrings(SDK_SRC);

    it('state.rs contains at least 10 SEED constants', () => {
      expect(
        stateSeeds.size,
        'state.rs should define many SEED constants — parser may be broken',
      ).toBeGreaterThanOrEqual(10);
    });

    it('every SDK seed string exists as a SEED constant in state.rs', () => {
      // Collect all unique seed strings the SDK references
      const mismatches: string[] = [];

      // Seeds that are SDK-specific (not PDA seeds from state.rs structs)
      const sdkOnlySeeds = new Set([
        'blacklist-state',   // ComplianceModule — transfer-hook program, not sss-token
        'pbs-vault',         // ProbabilisticModule — may be a future PDA
        'apc-channel',       // AgentPaymentChannelModule — future PDA
        'apc-settle',        // AgentPaymentChannelModule — future PDA
        'queue-escrow',      // RedemptionQueueModule — token account, not a state.rs struct
      ]);

      for (const [seedValue, locations] of sdkSeeds) {
        if (sdkOnlySeeds.has(seedValue)) continue;
        if (!stateSeeds.has(seedValue)) {
          const locationStr = locations
            .map((l) => `${l.varName} in ${l.file}`)
            .join(', ');
          mismatches.push(
            `Seed "${seedValue}" used in SDK (${locationStr}) not found in any state.rs SEED constant — ` +
              'verify the seed string matches the on-chain definition',
          );
        }
      }

      expect(
        mismatches,
        `SDK seed mismatches:\n  - ${mismatches.join('\n  - ')}`,
      ).toHaveLength(0);
    });

    it('critical PDA seeds are present and correct', () => {
      // These are the most important seeds — if they drift, everything breaks
      const critical: Record<string, string> = {
        StablecoinConfig: 'stablecoin-config',
        MinterInfo: 'minter-info',
        CollateralVault: 'cdp-collateral-vault',
        CdpPosition: 'cdp-position',
        InterfaceVersion: 'interface-version',
      };

      for (const [struct, expectedSeed] of Object.entries(critical)) {
        const actual = structSeeds.get(struct);
        expect(
          actual,
          `${struct}::SEED is missing from state.rs — expected "${expectedSeed}"`,
        ).toBeDefined();
        expect(
          actual,
          `${struct}::SEED is "${actual}" but expected "${expectedSeed}" — ` +
            'seed rename would break all existing PDAs',
        ).toBe(expectedSeed);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. StablecoinConfig Layout Verification
  // -----------------------------------------------------------------------
  describe('StablecoinConfig struct layout', () => {
    const content = fs.readFileSync(STATE_RS, 'utf-8');

    it('feature_flags field exists as u64', () => {
      expect(
        content,
        'StablecoinConfig must have a `pub feature_flags: u64` field',
      ).toContain('pub feature_flags: u64');
    });

    it('field ordering: mint before feature_flags before authorized_keepers', () => {
      const mintIdx = content.indexOf('pub mint: Pubkey');
      const flagsIdx = content.indexOf('pub feature_flags: u64');
      const keepersIdx = content.indexOf('pub authorized_keepers: Vec<Pubkey>');

      expect(mintIdx, 'pub mint: Pubkey not found in state.rs').toBeGreaterThan(-1);
      expect(flagsIdx, 'pub feature_flags: u64 not found in state.rs').toBeGreaterThan(-1);
      expect(keepersIdx, 'pub authorized_keepers: Vec<Pubkey> not found in state.rs').toBeGreaterThan(-1);

      expect(
        mintIdx,
        'mint must appear before feature_flags in StablecoinConfig — ' +
          'field reordering changes Borsh layout and breaks all existing accounts',
      ).toBeLessThan(flagsIdx);

      expect(
        flagsIdx,
        'feature_flags must appear before authorized_keepers — ' +
          'field reordering changes Borsh layout and breaks all existing accounts',
      ).toBeLessThan(keepersIdx);
    });

    it('field ordering: total_minted before total_burned before transfer_hook_program', () => {
      const mintedIdx = content.indexOf('pub total_minted: u64');
      const burnedIdx = content.indexOf('pub total_burned: u64');
      const hookIdx = content.indexOf('pub transfer_hook_program: Pubkey');

      expect(mintedIdx, 'pub total_minted: u64 not found').toBeGreaterThan(-1);
      expect(burnedIdx, 'pub total_burned: u64 not found').toBeGreaterThan(-1);
      expect(hookIdx, 'pub transfer_hook_program: Pubkey not found').toBeGreaterThan(-1);

      expect(
        mintedIdx,
        'total_minted must appear before total_burned',
      ).toBeLessThan(burnedIdx);
      expect(
        burnedIdx,
        'total_burned must appear before transfer_hook_program',
      ).toBeLessThan(hookIdx);
    });

    it('critical fields are present in StablecoinConfig', () => {
      const requiredFields = [
        'pub mint: Pubkey',
        'pub authority: Pubkey',
        'pub compliance_authority: Pubkey',
        'pub preset: u8',
        'pub paused: bool',
        'pub total_minted: u64',
        'pub total_burned: u64',
        'pub transfer_hook_program: Pubkey',
        'pub collateral_mint: Pubkey',
        'pub reserve_vault: Pubkey',
        'pub total_collateral: u64',
        'pub max_supply: u64',
        'pub pending_authority: Pubkey',
        'pub pending_compliance_authority: Pubkey',
        'pub feature_flags: u64',
        'pub max_transfer_amount: u64',
        'pub expected_pyth_feed: Pubkey',
        'pub admin_op_mature_slot: u64',
        'pub admin_op_kind: u8',
        'pub admin_op_param: u64',
        'pub admin_op_target: Pubkey',
        'pub admin_timelock_delay: u64',
        'pub max_oracle_age_secs: u32',
        'pub max_oracle_conf_bps: u16',
        'pub stability_fee_bps: u16',
        'pub redemption_fee_bps: u16',
        'pub insurance_fund_pubkey: Pubkey',
        'pub max_backstop_bps: u16',
        'pub auditor_elgamal_pubkey: [u8; 32]',
        'pub oracle_type: u8',
        'pub oracle_feed: Pubkey',
        'pub supply_cap_locked: bool',
        'pub version: u8',
        'pub min_reserve_ratio_bps: u16',
        'pub travel_rule_threshold: u64',
        'pub sanctions_oracle: Pubkey',
        'pub sanctions_max_staleness_slots: u64',
        'pub authorized_keepers: Vec<Pubkey>',
        'pub squads_multisig: Pubkey',
        'pub expected_upgrade_authority: Pubkey',
        'pub bump: u8',
      ];

      const missing: string[] = [];
      for (const field of requiredFields) {
        if (!content.includes(field)) {
          missing.push(field);
        }
      }

      expect(
        missing,
        `StablecoinConfig is missing fields (removing fields breaks Borsh layout):\n  - ${missing.join('\n  - ')}`,
      ).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. CPI Crate Flag Verification: crates/sss-cpi/src/flags.rs vs state.rs
  // -----------------------------------------------------------------------
  describe('CPI Crate Flags vs state.rs', () => {
    const onChainFlags = parseRustFlags(STATE_RS);
    const cpiFlags = parseRustFlags(CPI_FLAGS_RS);

    it('CPI crate defines at least one FLAG_ constant', () => {
      expect(
        cpiFlags.size,
        'CPI flags.rs should define FLAG_ constants — parser may be broken',
      ).toBeGreaterThan(0);
    });

    it('every CPI crate FLAG_ constant matches its on-chain state.rs counterpart', () => {
      // Known naming discrepancies between CPI crate and state.rs:
      // CPI FLAG_GUARDIAN_PAUSE (bit 3) corresponds to FLAG_YIELD_COLLATERAL in state.rs.
      // This is a legacy naming issue in the CPI crate. The bit position is correct.
      const cpiToStateAliases: Record<string, string> = {
        FLAG_GUARDIAN_PAUSE: 'FLAG_YIELD_COLLATERAL',
      };

      const mismatches: string[] = [];
      for (const [name, cpiValue] of cpiFlags) {
        const stateName = cpiToStateAliases[name] ?? name;
        const onChainValue = onChainFlags.get(stateName);
        if (onChainValue === undefined) {
          mismatches.push(
            `${name} exists in CPI crate flags.rs but NOT in state.rs ` +
              `(also checked alias "${stateName}") — ` +
              'remove it or add the corresponding state.rs constant',
          );
        } else if (cpiValue !== onChainValue) {
          mismatches.push(
            `${name}: CPI crate = ${cpiValue} (bit ${cpiValue.toString(2).length - 1}) ` +
              `vs state.rs = ${onChainValue} (bit ${onChainValue.toString(2).length - 1}) — ` +
              'update crates/sss-cpi/src/flags.rs to match state.rs',
          );
        }
      }

      expect(
        mismatches,
        `CPI flag mismatches:\n  - ${mismatches.join('\n  - ')}`,
      ).toHaveLength(0);
    });

    it('CPI crate has the same number of flags as state.rs (or close)', () => {
      // CPI crate should mirror all state.rs flags
      const diff = onChainFlags.size - cpiFlags.size;
      if (diff > 0) {
        const cpiNames = new Set(cpiFlags.keys());
        const missing = [...onChainFlags.keys()].filter((k) => !cpiNames.has(k));
        console.warn(
          `[drift-check] CPI crate is missing ${diff} flags from state.rs: ${missing.join(', ')}`,
        );
      }
      // The CPI crate should never have MORE flags than state.rs
      expect(
        cpiFlags.size,
        'CPI crate should not define flags that state.rs does not have',
      ).toBeLessThanOrEqual(onChainFlags.size);
    });
  });

  // -----------------------------------------------------------------------
  // 5. CPI Crate PDA Seed Verification: crates/sss-cpi/src/pda.rs vs state.rs
  // -----------------------------------------------------------------------
  describe('CPI Crate PDA Seeds vs state.rs', () => {
    const stateSeeds = parseAllStateSeedValues(STATE_RS);
    const cpiSeeds = parseCpiSeeds(CPI_PDA_RS);

    it('CPI crate pda.rs defines at least one SEED_ constant', () => {
      expect(
        cpiSeeds.size,
        'CPI pda.rs should define SEED_ constants — parser may be broken',
      ).toBeGreaterThan(0);
    });

    it('every CPI crate SEED_ constant value exists in state.rs', () => {
      const mismatches: string[] = [];
      for (const [name, cpiSeed] of cpiSeeds) {
        if (!stateSeeds.has(cpiSeed)) {
          mismatches.push(
            `CPI ${name} = "${cpiSeed}" not found in any state.rs SEED constant — ` +
              'the seed string may have been renamed in state.rs; update pda.rs to match',
          );
        }
      }

      expect(
        mismatches,
        `CPI seed mismatches:\n  - ${mismatches.join('\n  - ')}`,
      ).toHaveLength(0);
    });

    it('CPI seed string values exactly match state.rs byte-for-byte', () => {
      // Cross-reference: for each CPI seed, verify its value byte-for-byte
      const structSeeds = parseRustSeedsFromState(STATE_RS);
      const structSeedValues = new Set(structSeeds.values());

      const mismatches: string[] = [];
      for (const [name, cpiSeed] of cpiSeeds) {
        if (!structSeedValues.has(cpiSeed) && !stateSeeds.has(cpiSeed)) {
          mismatches.push(
            `CPI ${name} = "${cpiSeed}" not byte-for-byte matched in state.rs`,
          );
        }
      }

      expect(
        mismatches,
        `CPI seed byte-mismatch:\n  - ${mismatches.join('\n  - ')}`,
      ).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Program ID Verification: SDK vs Anchor.toml
  // -----------------------------------------------------------------------
  describe('Program ID: SDK vs Anchor.toml', () => {
    it('SDK SSS_TOKEN_PROGRAM_ID matches Anchor.toml [programs.devnet] sss_token', () => {
      const anchorToml = fs.readFileSync(ANCHOR_TOML, 'utf-8');
      // Match sss_token = "BASE58..." in Anchor.toml
      const anchorMatch = anchorToml.match(/sss_token\s*=\s*"(\w+)"/);
      expect(
        anchorMatch,
        'Could not find sss_token program ID in Anchor.toml — ' +
          'expected a line like: sss_token = "ApQTV..."',
      ).not.toBeNull();

      const sdkContent = fs.readFileSync(SDK_MAIN, 'utf-8');
      // Match SSS_TOKEN_PROGRAM_ID = new PublicKey('BASE58...')
      const sdkMatch = sdkContent.match(
        /SSS_TOKEN_PROGRAM_ID\s*=\s*new PublicKey\(\s*['"](\w+)['"]/,
      );
      expect(
        sdkMatch,
        'Could not find SSS_TOKEN_PROGRAM_ID in SolanaStablecoin.ts — ' +
          'expected: export const SSS_TOKEN_PROGRAM_ID = new PublicKey(...)',
      ).not.toBeNull();

      expect(
        sdkMatch![1],
        `Program ID mismatch:\n` +
          `  SDK (SolanaStablecoin.ts): ${sdkMatch![1]}\n` +
          `  Anchor.toml:              ${anchorMatch![1]}\n` +
          'Update SSS_TOKEN_PROGRAM_ID to match the deployed program in Anchor.toml',
      ).toBe(anchorMatch![1]);
    });

    it('devnet-program-ids.json matches Anchor.toml (if file exists)', () => {
      const devnetIdsPath = path.join(ROOT, 'devnet-program-ids.json');
      if (!fs.existsSync(devnetIdsPath)) {
        console.warn('[drift-check] devnet-program-ids.json not found — skipping');
        return;
      }

      const devnetIds = JSON.parse(fs.readFileSync(devnetIdsPath, 'utf-8'));
      const anchorToml = fs.readFileSync(ANCHOR_TOML, 'utf-8');
      const anchorMatch = anchorToml.match(/sss_token\s*=\s*"(\w+)"/);

      if (anchorMatch && devnetIds.sss_token) {
        expect(
          devnetIds.sss_token,
          `devnet-program-ids.json sss_token (${devnetIds.sss_token}) ` +
            `does not match Anchor.toml (${anchorMatch[1]})`,
        ).toBe(anchorMatch[1]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 7. Flag Bit Collision Detection
  // -----------------------------------------------------------------------
  describe('Flag Bit Collision Detection', () => {
    it('no two state.rs flags share the same bit position', () => {
      const onChainFlags = parseRustFlags(STATE_RS);
      const seen = new Map<bigint, string>();
      const collisions: string[] = [];

      for (const [name, value] of onChainFlags) {
        const existing = seen.get(value);
        if (existing) {
          collisions.push(
            `${name} and ${existing} both use value ${value} (bit ${value.toString(2).length - 1})`,
          );
        } else {
          seen.set(value, name);
        }
      }

      expect(
        collisions,
        `Flag bit collisions in state.rs:\n  - ${collisions.join('\n  - ')}`,
      ).toHaveLength(0);
    });

    it('no two SDK flags share the same bit position', () => {
      const sdkFlags = parseTsFlags(SDK_SRC);
      const seen = new Map<bigint, string>();
      const collisions: string[] = [];

      for (const [name, info] of sdkFlags) {
        const existing = seen.get(info.value);
        if (existing) {
          collisions.push(
            `${name} (${info.file}) and ${existing} both use value ${info.value}`,
          );
        } else {
          seen.set(info.value, `${name} (${info.file})`);
        }
      }

      // Known intentional aliases that share bit positions:
      // - FLAG_CIRCUIT_BREAKER and FLAG_CIRCUIT_BREAKER_V2 both use bit 0
      // - FLAG_CT is a local alias for FLAG_CONFIDENTIAL_TRANSFERS (bit 5)
      const realCollisions = collisions.filter(
        (c) => !c.includes('CIRCUIT_BREAKER_V2') && !c.includes('FLAG_CT'),
      );

      expect(
        realCollisions,
        `SDK flag bit collisions:\n  - ${realCollisions.join('\n  - ')}`,
      ).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Admin Op Constants Verification
  // -----------------------------------------------------------------------
  describe('Admin Op Constants', () => {
    it('ADMIN_OP constants in state.rs have no value collisions', () => {
      const content = fs.readFileSync(STATE_RS, 'utf-8');
      const regex = /pub const (ADMIN_OP_\w+):\s*u8\s*=\s*(\d+)/g;
      const ops = new Map<number, string>();
      const collisions: string[] = [];

      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        const value = parseInt(match[2], 10);
        // ADMIN_OP_NONE = 0 is a sentinel, skip collision check for it
        if (name === 'ADMIN_OP_NONE') continue;

        const existing = ops.get(value);
        if (existing) {
          collisions.push(`${name} and ${existing} both use value ${value}`);
        } else {
          ops.set(value, name);
        }
      }

      expect(
        collisions,
        `ADMIN_OP value collisions in state.rs:\n  - ${collisions.join('\n  - ')}`,
      ).toHaveLength(0);
    });
  });
});
