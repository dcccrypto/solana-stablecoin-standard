/**
 * ComplianceRuleEngine Module — SSS Direction 4
 *
 * TypeScript stubs for the on-chain Compliance Rule Engine.
 * Rules are stored on-chain as PDA entries; each transfer is evaluated
 * against all active rules before execution is permitted.
 *
 * Mirrors the rule types used in ComplianceModule.ts + tests/spikes/04-compliance-rule-engine.
 *
 * @module ComplianceRuleEngine
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

/** All supported compliance rule kinds */
export type RuleKind =
  | 'blacklist'
  | 'single-transaction-limit'
  | 'daily-velocity'
  | 'jurisdiction'
  | 'all'   // AND combinator: all sub-rules must pass
  | 'any';  // OR combinator: at least one sub-rule must pass

/**
 * Base interface shared by all rule types.
 */
export interface BaseRule {
  kind: RuleKind;
  /** Human-readable label for debugging */
  label?: string;
}

/** Blacklist rule: rejects transfers from/to blacklisted addresses */
export interface BlacklistRule extends BaseRule {
  kind: 'blacklist';
  blacklisted: PublicKey[];
}

/** Single-transaction limit: rejects transfers above a maximum amount */
export interface SingleTransactionLimitRule extends BaseRule {
  kind: 'single-transaction-limit';
  /** Maximum allowed amount per transaction (base units) */
  maxAmount: bigint;
}

/** Daily velocity rule: rejects if sender has transferred more than limit in 24h */
export interface DailyVelocityRule extends BaseRule {
  kind: 'daily-velocity';
  /** Maximum cumulative transfer per sender per 24h window (base units) */
  dailyLimit: bigint;
}

/** Jurisdiction rule: only allows transfers involving permitted country codes */
export interface JurisdictionRule extends BaseRule {
  kind: 'jurisdiction';
  /** ISO 3166-1 alpha-2 country codes that are permitted */
  allowedCountries: string[];
}

/** AND combinator: all nested rules must pass */
export interface AllRule extends BaseRule {
  kind: 'all';
  rules: ComplianceRule[];
}

/** OR combinator: at least one nested rule must pass */
export interface AnyRule extends BaseRule {
  kind: 'any';
  rules: ComplianceRule[];
}

/** Union of all rule types */
export type ComplianceRule =
  | BlacklistRule
  | SingleTransactionLimitRule
  | DailyVelocityRule
  | JurisdictionRule
  | AllRule
  | AnyRule;

// ---------------------------------------------------------------------------
// On-chain account types
// ---------------------------------------------------------------------------

/**
 * On-chain `ComplianceRule` PDA (seeds: ["compliance-rule", mint, rule_id]).
 * Stores a serialized rule entry.
 */
export interface ComplianceRuleAccount {
  /** Stablecoin mint this rule applies to */
  mint: PublicKey;
  /** Unique rule id (u64, monotonically increasing) */
  ruleId: bigint;
  /** Rule kind discriminator (stored as u8) */
  kind: RuleKind;
  /** Serialized rule payload (Borsh) */
  payload: Uint8Array;
  /** Whether this rule is currently active */
  enabled: boolean;
  /** Compliance authority that created this rule */
  authority: PublicKey;
}

// ---------------------------------------------------------------------------
// Transfer evaluation
// ---------------------------------------------------------------------------

/** Context passed to rule evaluation (mirrors the on-chain transfer hook context) */
export interface TransferContext {
  /** Sending token account */
  source: PublicKey;
  /** Receiving token account */
  destination: PublicKey;
  /** Transfer amount (base units) */
  amount: bigint;
  /** Unix timestamp of the transfer */
  timestamp: number;
  /** Optional: sender's declared jurisdiction (ISO alpha-2) */
  senderJurisdiction?: string;
  /** Optional: receiver's declared jurisdiction */
  receiverJurisdiction?: string;
}

/** Result of evaluating a rule set against a transfer */
export interface EvaluationResult {
  /** True if the transfer is permitted */
  allowed: boolean;
  /** Which rule blocked the transfer (if allowed = false) */
  blockedBy?: string;
  /** Detailed reason */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Instruction params
// ---------------------------------------------------------------------------

/**
 * Parameters for `add_rule`.
 * Compliance authority adds a new rule to the engine.
 */
export interface AddRuleParams {
  /** Stablecoin mint */
  mint: PublicKey;
  /** Compliance authority signer */
  complianceAuthority: PublicKey;
  /** Rule to add */
  rule: ComplianceRule;
}

/**
 * Parameters for `remove_rule`.
 * Compliance authority disables a rule by id.
 */
export interface RemoveRuleParams {
  /** Stablecoin mint */
  mint: PublicKey;
  /** Compliance authority signer */
  complianceAuthority: PublicKey;
  /** Rule id to disable */
  ruleId: bigint;
}

// ---------------------------------------------------------------------------
// Module stub
// ---------------------------------------------------------------------------

/**
 * ComplianceRuleEngine — stub interface for the SSS Direction 4 SDK module.
 *
 * Extends the existing `ComplianceModule` with a richer, composable rule set
 * that can be stored on-chain and evaluated during the Token-2022 transfer hook.
 *
 * @example
 * ```ts
 * const engine = new ComplianceRuleEngine(connection, programId);
 * const ix = await engine.addRule({ mint, complianceAuthority, rule: { kind: 'blacklist', blacklisted: [...] } });
 * const result = await engine.evaluateTransfer(mint, ctx);
 * ```
 */
export interface IComplianceRuleEngine {
  /**
   * Build an `add_rule` instruction.
   * Serializes the rule to Borsh and stores it in a PDA.
   */
  addRule(params: AddRuleParams): Promise<TransactionInstruction>;

  /**
   * Build a `remove_rule` instruction.
   * Disables the rule PDA (does not delete — preserves audit trail).
   */
  removeRule(params: RemoveRuleParams): Promise<TransactionInstruction>;

  /**
   * Evaluate a proposed transfer against all active rules for a mint.
   * Performs client-side simulation; on-chain transfer hook enforces the same logic.
   */
  evaluateTransfer(mint: PublicKey, ctx: TransferContext): Promise<EvaluationResult>;

  /**
   * Fetch all active compliance rules for a mint.
   */
  fetchRules(mint: PublicKey): Promise<ComplianceRuleAccount[]>;
}

// ---------------------------------------------------------------------------
// Client-side rule evaluator (off-chain utility)
// ---------------------------------------------------------------------------

/**
 * Evaluate a set of rules against a transfer context client-side.
 * Used for pre-flight checks before submitting a transaction.
 *
 * @param rules - Array of `ComplianceRule` to evaluate
 * @param ctx   - Transfer context
 * @returns     EvaluationResult
 */
export function evaluateRules(rules: ComplianceRule[], ctx: TransferContext): EvaluationResult {
  for (const rule of rules) {
    const result = evaluateSingleRule(rule, ctx);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

function evaluateSingleRule(rule: ComplianceRule, ctx: TransferContext): EvaluationResult {
  switch (rule.kind) {
    case 'blacklist': {
      const blocked = rule.blacklisted.some(
        (pk) => pk.equals(ctx.source) || pk.equals(ctx.destination),
      );
      return blocked
        ? { allowed: false, blockedBy: rule.label ?? 'blacklist', reason: 'Address is blacklisted' }
        : { allowed: true };
    }
    case 'single-transaction-limit': {
      const over = ctx.amount > rule.maxAmount;
      return over
        ? {
            allowed: false,
            blockedBy: rule.label ?? 'single-transaction-limit',
            reason: `Amount ${ctx.amount} exceeds per-tx limit ${rule.maxAmount}`,
          }
        : { allowed: true };
    }
    case 'daily-velocity':
      // Full implementation requires on-chain cumulative transfer tracking.
      // Client-side stub always passes; on-chain hook enforces.
      return { allowed: true };
    case 'jurisdiction': {
      if (ctx.senderJurisdiction && !rule.allowedCountries.includes(ctx.senderJurisdiction)) {
        return {
          allowed: false,
          blockedBy: rule.label ?? 'jurisdiction',
          reason: `Sender jurisdiction ${ctx.senderJurisdiction} is not permitted`,
        };
      }
      if (ctx.receiverJurisdiction && !rule.allowedCountries.includes(ctx.receiverJurisdiction)) {
        return {
          allowed: false,
          blockedBy: rule.label ?? 'jurisdiction',
          reason: `Receiver jurisdiction ${ctx.receiverJurisdiction} is not permitted`,
        };
      }
      return { allowed: true };
    }
    case 'all':
      return evaluateRules(rule.rules, ctx);
    case 'any': {
      for (const sub of rule.rules) {
        const r = evaluateSingleRule(sub, ctx);
        if (r.allowed) return { allowed: true };
      }
      return { allowed: false, blockedBy: rule.label ?? 'any', reason: 'No sub-rule permitted the transfer' };
    }
    default:
      return { allowed: true };
  }
}
