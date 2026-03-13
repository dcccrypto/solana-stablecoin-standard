#!/usr/bin/env node

import { Command } from "commander";
import { writeDefaultConfig, loadConfig, SssStandard } from "./config";
import { deployStablecoinFromConfig } from "./stablecoin/deploy";
import {
  runMint,
  runBurn,
  runFreeze,
  runThaw,
  runPause,
  runUnpause,
  runStatus,
  runSupply,
  runBalance,
  runSetAuthority,
  runAuditLog,
} from "./stablecoin/operations";
import {
  runBlacklistAdd,
  runBlacklistRemove,
  runBlacklistCheck,
} from "./stablecoin/blacklist";

const program = new Command();

program
  .name("sss-token")
  .description("CLI for managers of Solana stablecoins built on the Stablecoin Standard")
  .version("0.1.0");

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

program
  .command("mint")
  .description("Mint tokens to a recipient (creates ATA if needed)")
  .argument("<recipient>", "Recipient wallet address (base58)")
  .argument("<amount>", "Amount in raw units (e.g. 1000000 for 1 token with 6 decimals)")
  .option("--config <path>", "Path to config TOML")
  .action(async (recipient: string, amountStr: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      const amount = BigInt(amountStr);
      await runMint(cfg, recipient, amount);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("burn")
  .description("Burn tokens from the mint authority's token account")
  .argument("<amount>", "Amount in raw units to burn")
  .option("--config <path>", "Path to config TOML")
  .action(async (amountStr: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runBurn(cfg, BigInt(amountStr));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("freeze")
  .description("Freeze a token account (requires freeze authority)")
  .argument("<address>", "Token account address to freeze")
  .option("--config <path>", "Path to config TOML")
  .action(async (address: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runFreeze(cfg, address);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("thaw")
  .description("Thaw a frozen token account")
  .argument("<address>", "Token account address to thaw")
  .option("--config <path>", "Path to config TOML")
  .action(async (address: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runThaw(cfg, address);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("pause")
  .description("Pause mint/transfer/burn (Token-2022 Pausable extension)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runPause(cfg);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("unpause")
  .description("Resume mint/transfer/burn after pause")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runUnpause(cfg);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show token config and on-chain status (supply, authorities)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runStatus(cfg);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("supply")
  .description("Print total supply (raw and UI)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runSupply(cfg);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("balance")
  .description("Show balance of a wallet for the configured mint")
  .argument("<address>", "Wallet address (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (address: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runBalance(cfg, address);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("set-authority")
  .description("Update an authority (mint, freeze, metadata, pause, permanent-delegate)")
  .argument("<type>", "Authority type: mint | freeze | metadata | pause | permanent-delegate")
  .argument("<new-authority>", "New authority public key (base58), or 'none' to remove")
  .option("--config <path>", "Path to config TOML")
  .action(async (type: string, newAuthority: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runSetAuthority(cfg, type, newAuthority);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("audit-log")
  .description("Show recent transactions involving the configured mint (basic audit log)")
  .option("--limit <n>", "Number of signatures to fetch (default 20)")
  .option("--action <type>", "Planned filter by action type (not yet decoded)")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { limit?: string; action?: string; config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      const limit = opts.limit ? Math.max(1, Math.min(1000, Number(opts.limit))) : 20;
      await runAuditLog(cfg, limit, opts.action);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

const blacklist = program
  .command("blacklist")
  .description("Manage the on-chain blacklist (SSS-2 / transfer hook)");

blacklist
  .command("add")
  .description("Add a wallet to the blacklist (blocks future transfers)")
  .argument("<wallet>", "Wallet address to blacklist (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runBlacklistAdd(cfg, wallet);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

blacklist
  .command("remove")
  .description("Remove a wallet from the blacklist (re-enables transfers)")
  .argument("<wallet>", "Wallet address to unblacklist (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runBlacklistRemove(cfg, wallet);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

blacklist
  .command("check")
  .description("Check whether a wallet is currently blacklisted")
  .argument("<wallet>", "Wallet address to check (base58)")
  .option("--config <path>", "Path to config TOML")
  .action(async (wallet: string, opts: { config?: string }) => {
    try {
      const cfg = loadConfig(opts.config);
      await runBlacklistCheck(cfg, wallet);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
