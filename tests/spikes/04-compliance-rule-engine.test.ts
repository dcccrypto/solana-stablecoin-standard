/**
 * SSS-042 Direction 4: Compliance Rule Engine — Sample Rules
 *
 * Validates that the compliance rule engine:
 * - Evaluates blacklist rules correctly
 * - Applies amount limits (AML velocity checks)
 * - Handles jurisdiction-based restrictions
 * - Composes rules with AND/OR logic
 * - Returns structured violation details
 */

import { describe, it, expect } from "vitest";

// ─── Rule Engine Types ─────────────────────────────────────────────────────

interface TransactionContext {
  sender: string;
  recipient: string;
  amount: bigint;
  jurisdiction?: string;
  timestamp: number;
  /** Cumulative transferred in last 24h (for velocity checks). */
  dailyVolume: bigint;
}

type RuleResult =
  | { pass: true }
  | { pass: false; code: string; message: string };

type Rule = (ctx: TransactionContext) => RuleResult;

// ─── Rule Implementations ──────────────────────────────────────────────────

/** Rejects transactions involving blacklisted addresses. */
function blacklistRule(blacklist: Set<string>): Rule {
  return (ctx) => {
    if (blacklist.has(ctx.sender)) {
      return { pass: false, code: "BLACKLIST_SENDER", message: `Sender ${ctx.sender} is blacklisted` };
    }
    if (blacklist.has(ctx.recipient)) {
      return { pass: false, code: "BLACKLIST_RECIPIENT", message: `Recipient ${ctx.recipient} is blacklisted` };
    }
    return { pass: true };
  };
}

/** Rejects single transactions above a threshold (structuring detection). */
function singleTransactionLimitRule(maxAmount: bigint): Rule {
  return (ctx) => {
    if (ctx.amount > maxAmount) {
      return {
        pass: false,
        code: "AMOUNT_LIMIT_EXCEEDED",
        message: `Amount ${ctx.amount} exceeds limit ${maxAmount}`,
      };
    }
    return { pass: true };
  };
}

/** Rejects if daily volume (including this tx) would exceed AML limit. */
function dailyVelocityRule(maxDailyVolume: bigint): Rule {
  return (ctx) => {
    const projected = ctx.dailyVolume + ctx.amount;
    if (projected > maxDailyVolume) {
      return {
        pass: false,
        code: "DAILY_VELOCITY_EXCEEDED",
        message: `Daily volume ${projected} exceeds AML limit ${maxDailyVolume}`,
      };
    }
    return { pass: true };
  };
}

/** Rejects transactions from/to restricted jurisdictions. */
function jurisdictionRule(blockedJurisdictions: Set<string>): Rule {
  return (ctx) => {
    if (ctx.jurisdiction && blockedJurisdictions.has(ctx.jurisdiction)) {
      return {
        pass: false,
        code: "JURISDICTION_BLOCKED",
        message: `Jurisdiction ${ctx.jurisdiction} is restricted`,
      };
    }
    return { pass: true };
  };
}

/** Composes multiple rules: ALL must pass (AND logic). */
function allRules(...rules: Rule[]): Rule {
  return (ctx) => {
    for (const rule of rules) {
      const result = rule(ctx);
      if (!result.pass) return result;
    }
    return { pass: true };
  };
}

/** Composes multiple rules: at least one must pass (OR logic). */
function anyRule(...rules: Rule[]): Rule {
  return (ctx) => {
    const failures: RuleResult[] = [];
    for (const rule of rules) {
      const result = rule(ctx);
      if (result.pass) return { pass: true };
      failures.push(result);
    }
    // Return first failure if all fail
    return failures[0];
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────

const BLACKLIST = new Set(["BADACTOR1111111111111111111111111111111111111"]);
const MAX_AMOUNT = 10_000n * 1_000_000n; // $10,000 in 6-decimal units
const MAX_DAILY = 50_000n * 1_000_000n;  // $50,000/day AML limit
const BLOCKED_JURISDICTIONS = new Set(["OFAC-SDN", "XX"]);

const baseCtx: TransactionContext = {
  sender: "SENDER111111111111111111111111111111111111111",
  recipient: "RECIP111111111111111111111111111111111111111",
  amount: 1_000n * 1_000_000n,
  jurisdiction: "US",
  timestamp: Date.now(),
  dailyVolume: 0n,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Direction 4: Compliance Rule Engine — Sample Rules", () => {
  describe("Blacklist Rule", () => {
    const rule = blacklistRule(BLACKLIST);

    it("passes clean addresses", () => {
      expect(rule(baseCtx)).toEqual({ pass: true });
    });

    it("blocks blacklisted sender", () => {
      const result = rule({ ...baseCtx, sender: [...BLACKLIST][0] });
      expect(result.pass).toBe(false);
      expect((result as { pass: false; code: string }).code).toBe("BLACKLIST_SENDER");
    });

    it("blocks blacklisted recipient", () => {
      const result = rule({ ...baseCtx, recipient: [...BLACKLIST][0] });
      expect(result.pass).toBe(false);
      expect((result as { pass: false; code: string }).code).toBe("BLACKLIST_RECIPIENT");
    });
  });

  describe("Single Transaction Limit Rule", () => {
    const rule = singleTransactionLimitRule(MAX_AMOUNT);

    it("passes amount below limit", () => {
      expect(rule({ ...baseCtx, amount: MAX_AMOUNT - 1n })).toEqual({ pass: true });
    });

    it("passes amount at exactly the limit", () => {
      expect(rule({ ...baseCtx, amount: MAX_AMOUNT })).toEqual({ pass: true });
    });

    it("blocks amount above limit", () => {
      const result = rule({ ...baseCtx, amount: MAX_AMOUNT + 1n });
      expect(result.pass).toBe(false);
      expect((result as { pass: false; code: string }).code).toBe("AMOUNT_LIMIT_EXCEEDED");
    });

    it("blocks very large amounts", () => {
      const result = rule({ ...baseCtx, amount: 999_999n * 1_000_000n });
      expect(result.pass).toBe(false);
    });
  });

  describe("Daily Velocity Rule", () => {
    const rule = dailyVelocityRule(MAX_DAILY);

    it("passes when daily volume is zero", () => {
      expect(rule(baseCtx)).toEqual({ pass: true });
    });

    it("passes when projected volume is at limit", () => {
      const ctx = { ...baseCtx, dailyVolume: MAX_DAILY - baseCtx.amount };
      expect(rule(ctx)).toEqual({ pass: true });
    });

    it("blocks when projected volume exceeds limit", () => {
      const ctx = { ...baseCtx, dailyVolume: MAX_DAILY - baseCtx.amount + 1n };
      const result = rule(ctx);
      expect(result.pass).toBe(false);
      expect((result as { pass: false; code: string }).code).toBe("DAILY_VELOCITY_EXCEEDED");
    });

    it("blocks when already at limit with any amount", () => {
      const ctx = { ...baseCtx, dailyVolume: MAX_DAILY, amount: 1n };
      expect(rule(ctx).pass).toBe(false);
    });
  });

  describe("Jurisdiction Rule", () => {
    const rule = jurisdictionRule(BLOCKED_JURISDICTIONS);

    it("passes allowed jurisdiction", () => {
      expect(rule(baseCtx)).toEqual({ pass: true });
    });

    it("passes transaction with no jurisdiction set", () => {
      const ctx = { ...baseCtx, jurisdiction: undefined };
      expect(rule(ctx)).toEqual({ pass: true });
    });

    it("blocks restricted jurisdiction", () => {
      const ctx = { ...baseCtx, jurisdiction: "OFAC-SDN" };
      const result = rule(ctx);
      expect(result.pass).toBe(false);
      expect((result as { pass: false; code: string }).code).toBe("JURISDICTION_BLOCKED");
    });
  });

  describe("Composed Rules (AND)", () => {
    const composite = allRules(
      blacklistRule(BLACKLIST),
      singleTransactionLimitRule(MAX_AMOUNT),
      dailyVelocityRule(MAX_DAILY),
      jurisdictionRule(BLOCKED_JURISDICTIONS)
    );

    it("passes a clean transaction", () => {
      expect(composite(baseCtx)).toEqual({ pass: true });
    });

    it("fails if any one rule fails (blacklist)", () => {
      const result = composite({ ...baseCtx, sender: [...BLACKLIST][0] });
      expect(result.pass).toBe(false);
    });

    it("fails if any one rule fails (amount)", () => {
      const result = composite({ ...baseCtx, amount: MAX_AMOUNT + 1n });
      expect(result.pass).toBe(false);
    });

    it("fails on first violation encountered", () => {
      // Both blacklist and amount violated — should return first (blacklist)
      const result = composite({
        ...baseCtx,
        sender: [...BLACKLIST][0],
        amount: MAX_AMOUNT + 1n,
      });
      expect(result.pass).toBe(false);
      expect((result as { pass: false; code: string }).code).toBe("BLACKLIST_SENDER");
    });
  });

  describe("Composed Rules (OR — exception allowance)", () => {
    // OR: passes if either "internal whitelist" OR "amount is tiny" rule passes
    const internalWhitelist = new Set(["INTERNAL1111111111111111111111111111111111111"]);
    const isInternalSender = (ctx: TransactionContext): RuleResult =>
      internalWhitelist.has(ctx.sender)
        ? { pass: true }
        : { pass: false, code: "NOT_INTERNAL", message: "Not an internal sender" };
    const isTinyAmount = (ctx: TransactionContext): RuleResult =>
      ctx.amount <= 100n
        ? { pass: true }
        : { pass: false, code: "NOT_TINY", message: "Amount too large for OR-pass" };

    const orRule = anyRule(isInternalSender, isTinyAmount);

    it("passes if sender is internal", () => {
      const ctx = { ...baseCtx, sender: [...internalWhitelist][0], amount: 99999n };
      expect(orRule(ctx)).toEqual({ pass: true });
    });

    it("passes if amount is tiny", () => {
      expect(orRule({ ...baseCtx, amount: 50n })).toEqual({ pass: true });
    });

    it("fails if neither condition met", () => {
      const result = orRule({ ...baseCtx, amount: 1000n });
      expect(result.pass).toBe(false);
    });
  });
});
