#!/usr/bin/env node

import { Command } from "commander";
import { writeDefaultConfig, loadConfig, SssStandard } from "./config";

const program = new Command();

program
  .name("sss-token")
  .description("CLI for interacting with Solana Stablecoin Standard tokens")
  .version("0.1.0");

const init = program
  .command("init")
  .description("Initialize a config file for an SSS-compliant token");

init
  .option("--preset <name>", "Preset standard (sss-1 or sss-2)")
  .option("--custom <path>", "Use an existing custom config.toml")
  .action((opts: { preset?: string; custom?: string }) => {
    if (opts.custom) {
      try {
        const cfg = loadConfig(opts.custom);
        console.log("Loaded custom config for", cfg.standard, "from", opts.custom);
      } catch (err) {
        console.error("Failed to load custom config:", (err as Error).message);
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

    const path = writeDefaultConfig(preset);
    console.log(`Created config at ${path} for preset ${preset}.`);
  });

program
  .command("mint")
  .description("[SSS-1] Mint new stablecoins to a recipient")
  .argument("<recipient>", "Recipient wallet address")
  .argument("<amount>", "Amount to mint (in base units or decimals TBD)")
  .option("--config <path>", "Path to config TOML")
  .action(
    async (
      recipient: string,
      amountStr: string,
      opts: { config?: string },
    ) => {
      const cfg = loadConfig(opts.config);
      if (cfg.standard !== "sss-1") {
        console.error(
          `This command currently only supports SSS-1 configs. Found: ${cfg.standard}`,
        );
        process.exitCode = 1;
        return;
      }

      const amount = BigInt(amountStr);
      console.log(
        `[DRY RUN] Would mint ${amount.toString()} units to ${recipient} using mint ${cfg.stablecoinMint} on ${cfg.cluster}`,
      );
    },
  );

program
  .command("burn")
  .description("[SSS-1] Burn stablecoins from the authority's account")
  .argument("<amount>", "Amount to burn")
  .option("--config <path>", "Path to config TOML")
  .action(async (amountStr: string, opts: { config?: string }) => {
    const cfg = loadConfig(opts.config);
    if (cfg.standard !== "sss-1") {
      console.error(
        `This command currently only supports SSS-1 configs. Found: ${cfg.standard}`,
      );
      process.exitCode = 1;
      return;
    }

    const amount = BigInt(amountStr);
    console.log(
      `[DRY RUN] Would burn ${amount.toString()} units from authority for mint ${cfg.stablecoinMint} on ${cfg.cluster}`,
    );
  });

program
  .command("status")
  .description("[SSS-1] Show token status / supply snapshot")
  .option("--config <path>", "Path to config TOML")
  .action(async (opts: { config?: string }) => {
    const cfg = loadConfig(opts.config);
    if (cfg.standard !== "sss-1") {
      console.error(
        `This command currently only supports SSS-1 configs. Found: ${cfg.standard}`,
      );
      process.exitCode = 1;
      return;
    }

    console.log("Standard:", cfg.standard);
    console.log("Cluster:", cfg.cluster);
    console.log("Mint:", cfg.stablecoinMint || "(not set)");
    console.log("Authority keypair:", cfg.authorityKeypairPath);
    console.log(
      "[DRY RUN] On-chain queries for supply and authorities not implemented yet.",
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

