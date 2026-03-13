#!/usr/bin/env node

import { Command } from "commander";
import { writeDefaultConfig, loadConfig, SssStandard } from "./config";
import { deployStablecoinFromConfig } from "./stablecoin/deploy";

const program = new Command();

program
  .name("sss-token")
  .description("CLI for managers of Solana stablecoins built on the Stablecoin Standard")
  .version("0.1.0");

const init = program
  .command("init")
  .description(
    "Deploy or configure an SSS-compliant stablecoin from a TOML configuration",
  );

init
  .option("--preset <name>", "Generate a starter config (sss-1 or sss-2)")
  .option(
    "--custom <path>",
    "Deploy a new stablecoin from an existing config.toml",
  )
  .action(async (opts: { preset?: string; custom?: string }) => {
    if (opts.custom) {
      try {
        const cfg = await deployStablecoinFromConfig(opts.custom);
        // In a future iteration, this will write the on-chain mint address back into the config.
        console.log(
          "Config validated for deployment. (Dry run only, no on-chain transaction yet.)",
        );
        console.log("Standard:", cfg.standard, "Cluster:", cfg.cluster);
      } catch (err) {
        console.error("Failed to deploy from config:", (err as Error).message);
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
        `[DRY RUN] Would mint ${amount.toString()} units to ${recipient} using mint ${cfg.stablecoin.mint} on ${cfg.cluster}`,
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
      `[DRY RUN] Would burn ${amount.toString()} units from authority for mint ${cfg.stablecoin.mint} on ${cfg.cluster}`,
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
    console.log("Mint:", cfg.stablecoin.mint || "(not set)");
    console.log(
      "[DRY RUN] On-chain queries for supply and authorities not implemented yet.",
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

