#!/usr/bin/env node

import { Command } from "commander";
import { writeDefaultConfig, loadConfig, SssStandard } from "./config";
import { deployStablecoinFromConfig } from "./stablecoin/deploy";
import {
  runMint,
  runBurn,
  runTransfer,
  runFreeze,
  runThaw,
  runPause,
  runUnpause,
  runStatus,
  runSupply,
  runBalance,
  runSetAuthority,
  runAuditLog,
  runSeize,
} from "./stablecoin/operations";
import {
  runBlacklistAdd,
  runBlacklistRemove,
  runBlacklistClose,
  runBlacklistTransferAdmin,
  runBlacklistAcceptAdmin,
  runBlacklistCheck,
} from "./stablecoin/blacklist";
import { setOutputFormat } from "./output";

const program = new Command();

program
  .name("solana-stable")
  .description("CLI for the Solana Stablecoin Standard — deploy and manage SSS-1/SSS-2 stablecoins")
  .version("0.3.0")
  .option("--config <path>", "Path to config TOML (default: ./config.toml)")
  .option("--output <format>", "Output format: text | json (default: text)", "text")
  .option("--dry-run", "Simulate the transaction without sending")
  .option("--yes", "Skip confirmation prompts")
  .hook("preAction", () => {
    const globalOpts = program.opts();
    setOutputFormat(globalOpts.output ?? "text");
    if (globalOpts.dryRun) {
      process.env.SSS_DRY_RUN = "1";
    }
  });

function cfg(opts: { config?: string }) {
  const parent = program.opts();
  return loadConfig(opts.config ?? parent.config);
}

// ── init ─────────────────────────────────────────────────────────────

const init = program
  .command("init")
  .description("Create a config from a preset or deploy a new mint from an existing config");

init
  .option("--preset <name>", "Generate a starter config (sss-1 or sss-2)")
  .option("--custom <path>", "Deploy a new stablecoin from an existing config.toml")
  .action(async (opts: { preset?: string; custom?: string }) => {
    if (opts.custom) {
      try {
        await deployStablecoinFromConfig(opts.custom);
        console.log("Deployment complete.");
      } catch (err) {
        console.error("Deploy failed:", (err as Error).message);
        process.exitCode = 1;
      }
      return;
    }

    const preset = (opts.preset ?? "sss-1") as SssStandard;
    if (preset !== "sss-1" && preset !== "sss-2") {
      console.error('Invalid preset. Use "sss-1" or "sss-2".');
      process.exitCode = 1;
      return;
    }

    const outPath = writeDefaultConfig(preset);
    console.log(`Created config at ${outPath} for preset ${preset}.`);
  });

// ── operate — day-to-day token operations ────────────────────────────

const operate = program
  .command("operate")
  .description("Day-to-day token operations (mint, burn, transfer)");

operate
  .command("mint")
  .description("Mint tokens to a recipient (creates ATA if needed)")
  .argument("<recipient>", "Recipient wallet address (base58)")
  .argument("<amount>", "Amount in raw units")
  .option("--config <path>", "Path to config TOML")
  .action(async (recipient: string, amountStr: string, opts: { config?: string }) => {
    try {
      await runMint(cfg(opts), recipient, BigInt(amountStr));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

operate
  .command("burn")
  .description("Burn tokens from the mint authority's token account")
  .argument("<amount>", "Amount in raw units to burn")
  .option("--config <path>", "Path to config TOML")
  .action(async (amountStr: string, opts: { config?: string }) => {
    try {
      await runBurn(cfg(opts), BigInt(amountStr));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

operate
  .command("transfer")
  .description("Transfer tokens to a recipient (supports transfer hooks)")
  .argument("<recipient>", "Recipient wallet address (base58)")
  .argument("<amount>", "Amount in raw units")
  .option("--config <path>", "Path to config TOML")
  .action(async (recipient: string, amountStr: string, opts: { config?: string }) => {
    try {
      await runTransfer(cfg(opts), recipient, BigInt(amountStr));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

// ── admin — authority & account management ───────────────────────────

const admin = program
  .command("admin")
  .description("Authority & account management (freeze, thaw, pause, set-authority)");

admin
  .command("freeze")
  .description("Freeze a token account (requires freeze authority)")
  .argument("<address>", "Token account address to freeze")
  .option("--config <path>", "Path to config TOML")
  .action(async (address: string, opts: { config?: string }) => {
    try {
      await runFreeze(cfg(opts), address);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

admin
  .command("thaw")
  .description("Thaw a frozen token account")
  .argument("<address>", "Token account address to thaw")
  .option("--config <path>", "Path to config TOML")
  .action(async (address: string, opts: { config?: string }) => {
    try {
      await runThaw(cfg(opts), address);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

admin
  .command("pause")
  .description("Pause mint/transfer/burn (Token-2022 Pausable extension)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      await runPause(cfg(opts));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

admin
  .command("unpause")
  .description("Resume mint/transfer/burn after pause")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      await runUnpause(cfg(opts));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

admin
  .command("set-authority")
  .description("Update an authority (mint, freeze, metadata, pause, permanent-delegate)")
  .argument("<type>", "Authority type: mint | freeze | metadata | pause | permanent-delegate")
  .argument("<new-authority>", "New authority public key (base58), or 'none' to remove")
  .option("--config <path>", "Path to config TOML")
  .action(async (type: string, newAuthority: string, opts: { config?: string }) => {
    try {
      await runSetAuthority(cfg(opts), type, newAuthority);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

admin
  .command("seize")
  .description("Seize tokens from a frozen account (thaw → burn → mint to treasury → re-freeze)")
  .argument("<target-token-account>", "Token account to seize from (must be frozen)")
  .argument("<treasury>", "Treasury wallet to receive seized tokens")
  .argument("<amount>", "Amount in raw units")
  .option("--config <path>", "Path to config TOML")
  .action(async (target: string, treasury: string, amount: string, opts: { config?: string }) => {
    try {
      await runSeize(cfg(opts), target, treasury, BigInt(amount));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

// ── compliance — blacklist & compliance management ───────────────────

const compliance = program
  .command("compliance")
  .description("Blacklist & compliance management (SSS-2 transfer hook)");

compliance
  .command("add")
  .description("Add a wallet to the blacklist (blocks future transfers)")
  .argument("<wallet>", "Wallet address to blacklist (base58)")
  .option("--reason <text>", "Reason for blacklisting (stored in on-chain event)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { reason?: string; config?: string }) => {
    try {
      await runBlacklistAdd(cfg(opts), wallet, opts.reason);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

compliance
  .command("remove")
  .description("Remove a wallet from the blacklist (re-enables transfers)")
  .argument("<wallet>", "Wallet address to unblacklist (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { config?: string }) => {
    try {
      await runBlacklistRemove(cfg(opts), wallet);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

compliance
  .command("check")
  .description("Check whether a wallet is currently blacklisted")
  .argument("<wallet>", "Wallet address to check (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { config?: string }) => {
    try {
      await runBlacklistCheck(cfg(opts), wallet);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

compliance
  .command("close")
  .description("Close an unblocked blacklist entry to reclaim rent")
  .argument("<wallet>", "Wallet address whose entry to close (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { config?: string }) => {
    try {
      await runBlacklistClose(cfg(opts), wallet);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

compliance
  .command("transfer-admin")
  .description("Nominate a new blacklist admin (two-step: nominate → accept)")
  .argument("<new-admin>", "New admin wallet address (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (newAdmin: string, opts: { config?: string }) => {
    try {
      await runBlacklistTransferAdmin(cfg(opts), newAdmin);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

compliance
  .command("accept-admin")
  .description("Accept a pending blacklist admin nomination")
  .argument("<keypair-path>", "Path to the nominated admin's keypair JSON")
  .option("--config <path>", "Path to config TOML")
  .action(async (keypairPath: string, opts: { config?: string }) => {
    try {
      await runBlacklistAcceptAdmin(cfg(opts), keypairPath);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

// ── inspect — read-only queries ──────────────────────────────────────

const inspect = program
  .command("inspect")
  .description("Read-only queries (status, supply, balance, audit-log)");

inspect
  .command("status")
  .description("Show token config and on-chain status (supply, authorities)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      await runStatus(cfg(opts));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

inspect
  .command("supply")
  .description("Print total supply (raw and UI)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      await runSupply(cfg(opts));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

inspect
  .command("balance")
  .description("Show balance of a wallet for the configured mint")
  .argument("<address>", "Wallet address (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (address: string, opts: { config?: string }) => {
    try {
      await runBalance(cfg(opts), address);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

inspect
  .command("audit-log")
  .description("Show recent transactions involving the configured mint (basic audit log)")
  .option("--limit <n>", "Number of signatures to fetch (default 20)")
  .option("--action <type>", "Filter by action type")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { limit?: string; action?: string; config?: string }) => {
    try {
      const limit = opts.limit ? Math.max(1, Math.min(1000, Number(opts.limit))) : 20;
      await runAuditLog(cfg(opts), limit, opts.action);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

// ── Backward-compatible top-level aliases ────────────────────────────
// Keep flat commands for backward compatibility with existing scripts

for (const [name, desc, args, handler] of [
  ["mint", "Alias for: operate mint", ["<recipient>", "<amount>"], async (r: string, a: string, o: { config?: string }) => runMint(cfg(o), r, BigInt(a))],
  ["burn", "Alias for: operate burn", ["<amount>"], async (a: string, o: { config?: string }) => runBurn(cfg(o), BigInt(a))],
  ["transfer", "Alias for: operate transfer", ["<recipient>", "<amount>"], async (r: string, a: string, o: { config?: string }) => runTransfer(cfg(o), r, BigInt(a))],
  ["freeze", "Alias for: admin freeze", ["<address>"], async (a: string, o: { config?: string }) => runFreeze(cfg(o), a)],
  ["thaw", "Alias for: admin thaw", ["<address>"], async (a: string, o: { config?: string }) => runThaw(cfg(o), a)],
  ["pause", "Alias for: admin pause", [], async (o: { config?: string }) => runPause(cfg(o))],
  ["unpause", "Alias for: admin unpause", [], async (o: { config?: string }) => runUnpause(cfg(o))],
  ["status", "Alias for: inspect status", [], async (o: { config?: string }) => runStatus(cfg(o))],
  ["supply", "Alias for: inspect supply", [], async (o: { config?: string }) => runSupply(cfg(o))],
] as const) {
  const cmd = program.command(name).description(desc as string).option("--config <path>", "Path to config TOML");
  for (const arg of args as unknown as string[]) cmd.argument(arg);
  cmd.action(async (...actionArgs: any[]) => {
    try {
      await (handler as Function)(...actionArgs);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });
}

// Legacy blacklist group alias
const blacklist = program
  .command("blacklist")
  .description("Alias for: compliance (backward compatible)");

blacklist
  .command("add")
  .description("Add a wallet to the blacklist")
  .argument("<wallet>", "Wallet address (base58)")
  .option("--reason <text>", "Reason for blacklisting")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { reason?: string; config?: string }) => {
    try {
      await runBlacklistAdd(cfg(opts), wallet, opts.reason);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

blacklist
  .command("remove")
  .argument("<wallet>")
  .option("--config <path>")
  .action(async (wallet: string, opts: { config?: string }) => {
    try { await runBlacklistRemove(cfg(opts), wallet); } catch (err) { console.error((err as Error).message); process.exitCode = 1; }
  });

blacklist
  .command("check")
  .argument("<wallet>")
  .option("--config <path>")
  .action(async (wallet: string, opts: { config?: string }) => {
    try { await runBlacklistCheck(cfg(opts), wallet); } catch (err) { console.error((err as Error).message); process.exitCode = 1; }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
