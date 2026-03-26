#!/usr/bin/env ts-node
/**
 * liquidity-stress-test.ts — SSS-149 MiCA Art. 45 Liquidity Stress Test
 *
 * Models redemption rush scenarios for significant ARTs / e-money tokens.
 * Required for MiCA Art. 45 significant issuers.
 *
 * Simulates: given a TVL, redemption pool size, and redemption rate,
 * computes time to pool drain, SLA breach probability, and insurance
 * fund drawdown estimate.
 *
 * Usage:
 *   npx ts-node scripts/liquidity-stress-test.ts [OPTIONS]
 *
 * Options:
 *   --tvl <USD>              Total value locked (circulating supply × peg price)
 *   --pool-size <USD>        Redemption pool / liquid reserve size
 *   --insurance <USD>        Insurance fund size (SSS backstop)
 *   --rate <percent/day>     Daily redemption rate as % of TVL (e.g. 10 = 10%/day)
 *   --sla <hours>            Redemption SLA in hours (default: 24)
 *   --days <N>               Simulation duration in days (default: 30)
 *   --scenarios              Run all preset scenarios (bank-run, normal, stress)
 *   --json                   Output raw JSON (for NCA submission)
 *
 * Exit codes:
 *   0  — Pool survives full simulation
 *   1  — Pool drained before simulation end
 *   2  — Configuration error
 *
 * Example (MiCA significant issuer — €2B TVL):
 *   npx ts-node scripts/liquidity-stress-test.ts \
 *     --tvl 2000000000 --pool-size 200000000 --insurance 50000000 \
 *     --rate 15 --scenarios
 */

import * as process from 'process';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const bold   = (t: string) => `${C.bold}${t}${C.reset}`;
const dim    = (t: string) => `${C.dim}${t}${C.reset}`;
const red    = (t: string) => `${C.red}${t}${C.reset}`;
const green  = (t: string) => `${C.green}${t}${C.reset}`;
const yellow = (t: string) => `${C.yellow}${t}${C.reset}`;
const cyan   = (t: string) => `${C.cyan}${t}${C.reset}`;

function fmt$$(n: number): string {
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtHours(h: number): string {
  if (h < 1) return `${(h * 60).toFixed(0)}min`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimParams {
  tvlUsd: number;
  poolUsd: number;
  insuranceUsd: number;
  dailyRatePct: number;
  slaSours: number;
  days: number;
  label?: string;
}

interface DailyState {
  day: number;
  redemptionsDemanded: number;
  redemptionsFulfilled: number;
  poolBalance: number;
  insuranceBalance: number;
  slaBreach: boolean;
  poolDrained: boolean;
  cumulativeRedeemed: number;
  remainingCirculating: number;
}

interface SimResult {
  params: SimParams;
  poolDrainDay: number | null;   // null = pool survived
  insuranceDrainDay: number | null;
  slaBreach: boolean;
  slaBreach24hDay: number | null;
  totalRedemptions: number;
  maxDailyRedemption: number;
  survivedFullSim: boolean;
  daily: DailyState[];
  summary: string;
}

// ─── Core simulation ──────────────────────────────────────────────────────────

/**
 * Simulate a redemption event over `days` days.
 *
 * Model:
 * - Day 1–3: panic surge (2× base rate)
 * - Day 4–7: elevated (1.5× base rate)
 * - Day 8+: normalising (base rate × decay)
 * - Pool refills at rate of `refillRatePctOfTvlPerDay` from reserve access (default 2%/day)
 */
function simulate(params: SimParams, refillRatePctPerDay: number = 2): SimResult {
  const {
    tvlUsd, poolUsd, insuranceUsd, dailyRatePct, slaSours, days,
  } = params;

  let pool     = poolUsd;
  let insurance = insuranceUsd;
  let circulating = tvlUsd;
  let cumulative  = 0;
  let poolDrainDay: number | null = null;
  let insuranceDrainDay: number | null = null;
  let slaBreach = false;
  let slaBreach24hDay: number | null = null;
  let maxDailyRedemption = 0;

  const daily: DailyState[] = [];

  for (let day = 1; day <= days; day++) {
    // Redemption demand: panic surge profile
    let multiplier: number;
    if      (day <= 3) multiplier = 2.0;
    else if (day <= 7) multiplier = 1.5;
    else              multiplier = Math.max(0.1, 1.0 * Math.pow(0.85, day - 8));

    const demanded = Math.min(circulating, circulating * (dailyRatePct / 100) * multiplier);
    maxDailyRedemption = Math.max(maxDailyRedemption, demanded);

    // Refill pool from reserves (represents pulling from custodian bank)
    const refill = Math.min(circulating * (refillRatePctPerDay / 100), tvlUsd * 0.05); // cap refill at 5% TVL/day
    pool = Math.min(pool + refill, poolUsd * 2); // pool can grow up to 2× initial (reserve transfers)

    // Fulfil redemptions from pool
    let fulfilled = 0;
    if (pool >= demanded) {
      fulfilled = demanded;
      pool -= demanded;
    } else {
      // Pool insufficient — tap insurance fund
      fulfilled = pool;
      const gap = demanded - pool;
      pool = 0;

      if (insurance >= gap) {
        insurance -= gap;
        fulfilled = demanded;
      } else {
        // Both pool and insurance insufficient — SLA breach
        fulfilled += insurance;
        insurance = 0;
        slaBreach = true;
        if (slaBreach24hDay === null) slaBreach24hDay = day;
      }
    }

    circulating -= fulfilled;
    cumulative += fulfilled;

    const isPoolDrained = pool <= 0 && poolDrainDay === null;
    if (isPoolDrained) poolDrainDay = day;

    const isInsuranceDrained = insurance <= 0 && insuranceDrainDay === null;
    if (isInsuranceDrained) insuranceDrainDay = day;

    daily.push({
      day,
      redemptionsDemanded: demanded,
      redemptionsFulfilled: fulfilled,
      poolBalance: Math.max(0, pool),
      insuranceBalance: Math.max(0, insurance),
      slaBreach: slaBreach && fulfilled < demanded,
      poolDrained: pool <= 0,
      cumulativeRedeemed: cumulative,
      remainingCirculating: Math.max(0, circulating),
    });

    if (circulating <= 0) break; // all tokens redeemed
  }

  const survivedFullSim = poolDrainDay === null && insuranceDrainDay === null && !slaBreach;

  let summary: string;
  if (survivedFullSim) {
    summary = `✅ PASS — Pool survived ${days}-day simulation. Remaining pool: ${fmt$$(pool)}. SLA maintained throughout.`;
  } else if (slaBreach) {
    summary = `❌ FAIL — SLA breach on Day ${slaBreach24hDay}. Pool drained Day ${poolDrainDay ?? 'N/A'}, insurance drained Day ${insuranceDrainDay ?? 'N/A'}.`;
  } else if (poolDrainDay && !insuranceDrainDay) {
    summary = `⚠️  WARN — Pool drained on Day ${poolDrainDay} but insurance fund absorbed remainder. SLA maintained.`;
  } else {
    summary = `❌ FAIL — Insufficient liquidity. Pool drain Day ${poolDrainDay}, insurance drain Day ${insuranceDrainDay}.`;
  }

  return {
    params,
    poolDrainDay,
    insuranceDrainDay,
    slaBreach,
    slaBreach24hDay,
    totalRedemptions: cumulative,
    maxDailyRedemption,
    survivedFullSim,
    daily,
    summary,
  };
}

// ─── Preset scenarios ─────────────────────────────────────────────────────────

function buildScenarios(tvl: number, pool: number, insurance: number): SimParams[] {
  return [
    {
      label: 'Normal Operations',
      tvlUsd: tvl, poolUsd: pool, insuranceUsd: insurance,
      dailyRatePct: 2, slaSours: 24, days: 30,
    },
    {
      label: 'Moderate Stress (5%/day)',
      tvlUsd: tvl, poolUsd: pool, insuranceUsd: insurance,
      dailyRatePct: 5, slaSours: 24, days: 30,
    },
    {
      label: 'Severe Stress (15%/day)',
      tvlUsd: tvl, poolUsd: pool, insuranceUsd: insurance,
      dailyRatePct: 15, slaSours: 24, days: 14,
    },
    {
      label: 'Bank Run (30%/day, MiCA worst-case)',
      tvlUsd: tvl, poolUsd: pool, insuranceUsd: insurance,
      dailyRatePct: 30, slaSours: 24, days: 7,
    },
    {
      label: 'Flash Redemption (50% on Day 1)',
      tvlUsd: tvl, poolUsd: pool, insuranceUsd: insurance,
      dailyRatePct: 50, slaSours: 2, days: 3,
    },
  ];
}

// ─── Render result table ──────────────────────────────────────────────────────

function renderResult(r: SimResult, verbose: boolean = false) {
  const p = r.params;
  const statusIcon = r.survivedFullSim ? green('✅ PASS') : r.slaBreach ? red('❌ FAIL') : yellow('⚠️  WARN');

  console.log(`\n${bold(p.label ?? 'Custom Scenario')}`);
  console.log(dim('─'.repeat(60)));
  console.log(`  TVL:              ${fmt$$(p.tvlUsd)}`);
  console.log(`  Pool size:        ${fmt$$(p.poolUsd)} (${(p.poolUsd / p.tvlUsd * 100).toFixed(1)}% of TVL)`);
  console.log(`  Insurance fund:   ${fmt$$(p.insuranceUsd)} (${(p.insuranceUsd / p.tvlUsd * 100).toFixed(1)}% of TVL)`);
  console.log(`  Redemption rate:  ${p.dailyRatePct}%/day (panic surge 2× Day 1–3)`);
  console.log(`  SLA:              ${fmtHours(p.slaSours)}`);
  console.log(`  Sim duration:     ${p.days} days`);
  console.log(dim('─'.repeat(60)));
  console.log(`  Total redeemed:   ${fmt$$(r.totalRedemptions)} (${(r.totalRedemptions / p.tvlUsd * 100).toFixed(1)}% of TVL)`);
  console.log(`  Max daily redeem: ${fmt$$(r.maxDailyRedemption)}`);
  console.log(`  Pool drain day:   ${r.poolDrainDay ? `Day ${r.poolDrainDay}` : 'Never'}`);
  console.log(`  Insurance drain:  ${r.insuranceDrainDay ? `Day ${r.insuranceDrainDay}` : 'Never'}`);
  console.log(`  SLA breach:       ${r.slaBreach ? red(`Day ${r.slaBreach24hDay}`) : green('None')}`);
  console.log(`\n  Status: ${statusIcon}`);
  console.log(`  ${r.summary}`);

  if (verbose) {
    console.log(`\n  ${bold('Daily breakdown:')}`);
    console.log(`  ${'Day'.padEnd(5)} ${'Demanded'.padEnd(14)} ${'Fulfilled'.padEnd(14)} ${'Pool'.padEnd(14)} ${'Insurance'.padEnd(14)} ${'SLA'}`);
    console.log(dim(`  ${'─'.repeat(70)}`));
    for (const d of r.daily) {
      const slaFlag = d.slaBreach ? red('BREACH') : '';
      const poolFlag = d.poolDrained ? yellow(' (drained)') : '';
      console.log(
        `  ${String(d.day).padEnd(5)} ${fmt$$(d.redemptionsDemanded).padEnd(14)} ${fmt$$(d.redemptionsFulfilled).padEnd(14)} ${(fmt$$(d.poolBalance) + poolFlag).padEnd(23)} ${fmt$$(d.insuranceBalance).padEnd(14)} ${slaFlag}`
      );
    }
  }
}

// ─── MiCA recommendations ─────────────────────────────────────────────────────

function renderMiCaRecommendations(results: SimResult[], tvl: number, pool: number, insurance: number) {
  console.log(`\n${bold('MiCA Art. 45 Recommendations')}`);
  console.log(dim('─'.repeat(60)));

  const bankRunResult = results.find(r => r.params.label?.includes('Bank Run'));
  const stressResult  = results.find(r => r.params.label?.includes('Severe'));

  // MiCA significant issuers: must maintain ≥15% liquid reserves
  const liquidityRatio = pool / tvl;
  if (liquidityRatio < 0.15) {
    console.log(red(`  ❌ Liquid reserve ratio ${(liquidityRatio * 100).toFixed(1)}% is below MiCA Art.45 15% minimum for significant issuers`));
    const required = tvl * 0.15;
    console.log(yellow(`     → Top up redemption pool by ${fmt$$(required - pool)} to reach ${fmt$$(required)}`));
  } else {
    console.log(green(`  ✅ Liquid reserve ratio ${(liquidityRatio * 100).toFixed(1)}% meets MiCA Art. 45 15% floor`));
  }

  const insuranceRatio = insurance / tvl;
  if (insuranceRatio < 0.03) {
    console.log(yellow(`  ⚠️  Insurance fund ${(insuranceRatio * 100).toFixed(1)}% of TVL — consider increasing to ≥3% for MiCA significant issuer buffer`));
  } else {
    console.log(green(`  ✅ Insurance fund ${(insuranceRatio * 100).toFixed(1)}% of TVL`));
  }

  if (bankRunResult && !bankRunResult.survivedFullSim) {
    console.log(red(`  ❌ Bank-run scenario (30%/day) results in SLA breach — recovery plan activation required at this TVL`));
    const requiredPool = tvl * 0.30;
    console.log(yellow(`     → Pool would need to be ${fmt$$(requiredPool)} (30% TVL) to absorb Day-1 demand`));
  } else if (bankRunResult) {
    console.log(green(`  ✅ Bank-run scenario (30%/day) survived with pool + insurance`));
  }

  if (stressResult && stressResult.poolDrainDay && stressResult.poolDrainDay <= 3) {
    console.log(yellow(`  ⚠️  Severe stress (15%/day) drains pool by Day ${stressResult.poolDrainDay} — activate rate limits at Level 2 (25% TVL/24h)`));
  }

  console.log(`\n  ${cyan('Suggested recovery triggers for this TVL:')}`);
  console.log(`    Level 1 (Watch):  Redemptions > ${fmt$$(tvl * 0.10)}/day  (10% TVL)`);
  console.log(`    Level 2 (Alert):  Redemptions > ${fmt$$(tvl * 0.25)}/day  (25% TVL) or pool < ${fmt$$(pool * 0.50)}`);
  console.log(`    Level 3 (Crisis): Pool < ${fmt$$(pool * 0.20)} or SLA at risk`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function parseArg(args: string[], flag: string, fallback?: number): number | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return parseFloat(args[idx + 1]);
  return fallback;
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode     = args.includes('--json');
  const allScenarios = args.includes('--scenarios');
  const verbose      = args.includes('--verbose') || args.includes('-v');

  const tvl       = parseArg(args, '--tvl');
  const poolSize  = parseArg(args, '--pool-size');
  const insurance = parseArg(args, '--insurance', 0);
  const rate      = parseArg(args, '--rate');
  const sla       = parseArg(args, '--sla', 24)!;
  const days      = parseArg(args, '--days', 30)!;

  if (!tvl || !poolSize) {
    console.error('Usage: liquidity-stress-test.ts --tvl <USD> --pool-size <USD> [--insurance <USD>] [--rate <pct/day>] [--scenarios] [--json]');
    console.error('');
    console.error('Examples:');
    console.error('  # Basic stress test');
    console.error('  npx ts-node scripts/liquidity-stress-test.ts --tvl 500000000 --pool-size 75000000 --insurance 15000000 --rate 10');
    console.error('');
    console.error('  # Full scenario suite (MiCA significant issuer)');
    console.error('  npx ts-node scripts/liquidity-stress-test.ts --tvl 2000000000 --pool-size 300000000 --insurance 60000000 --scenarios');
    process.exit(2);
  }

  if (!jsonMode) {
    console.log(`\n${bold('SSS Liquidity Stress Test')}  ${dim('(MiCA Art. 45)')}`);
    console.log(dim('─'.repeat(60)));
    console.log(`Run date:    ${new Date().toISOString()}`);
    console.log(`TVL:         ${fmt$$(tvl)}`);
    console.log(`Pool:        ${fmt$$(poolSize)} (${(poolSize / tvl * 100).toFixed(1)}% TVL)`);
    console.log(`Insurance:   ${fmt$$(insurance!)} (${(insurance! / tvl * 100).toFixed(1)}% TVL)`);
  }

  const simParams: SimParams[] = allScenarios
    ? buildScenarios(tvl, poolSize, insurance!)
    : [{
        label: 'Custom Scenario',
        tvlUsd: tvl, poolUsd: poolSize, insuranceUsd: insurance!,
        dailyRatePct: rate ?? 10, slaSours: sla, days,
      }];

  const results: SimResult[] = simParams.map(p => simulate(p));

  if (jsonMode) {
    const out = {
      generatedAt: new Date().toISOString(),
      params: { tvl, poolSize, insurance, scenarios: simParams.length },
      results: results.map(r => ({
        label: r.params.label,
        survivedFullSim: r.survivedFullSim,
        poolDrainDay: r.poolDrainDay,
        insuranceDrainDay: r.insuranceDrainDay,
        slaBreach: r.slaBreach,
        slaBreach24hDay: r.slaBreach24hDay,
        totalRedemptions: r.totalRedemptions,
        maxDailyRedemption: r.maxDailyRedemption,
        summary: r.summary,
        daily: r.daily,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(results.some(r => !r.survivedFullSim) ? 1 : 0);
  }

  for (const r of results) {
    renderResult(r, verbose);
  }

  if (allScenarios) {
    renderMiCaRecommendations(results, tvl, poolSize, insurance!);
  }

  const anyFail = results.some(r => r.slaBreach || (r.poolDrainDay && r.insuranceDrainDay));
  console.log(`\n${dim('─'.repeat(60))}`);
  console.log(anyFail
    ? red(`\n❌ One or more scenarios result in SLA breach or complete liquidity failure. Review recovery plan.\n`)
    : green(`\n✅ All scenarios survived (or absorbed by insurance fund). Liquidity posture adequate.\n`)
  );
  process.exit(anyFail ? 1 : 0);
}

main();
