import { loadConfig, SssConfig } from "../config";

/**
 * High-level deploy helper.
 *
 * In the "no stablecoin yet" flow, the user provides a config.toml describing:
 * - which standard to target (sss-1 / sss-2),
 * - which authorities should control which capabilities,
 * - which Token-2022 extensions should be enabled.
 *
 * This function will eventually:
 * - create the mint account using the appropriate token program,
 * - initialize all requested extensions,
 * - write the resulting mint address back into the config file.
 *
 * For now, it only validates and prints a dry-run summary.
 */
export async function deployStablecoinFromConfig(
  configPath?: string,
): Promise<SssConfig> {
  const cfg = loadConfig(configPath);

  // TODO: wire in @solana/web3.js + token-2022 helper library calls.
  // For now, just surface a structured summary so we can iterate on the config shape.
  console.log("=== SSS deploy dry run ===");
  console.log("Standard:", cfg.standard);
  console.log("Cluster:", cfg.cluster);
  console.log("Token program:", cfg.stablecoin.tokenProgram);
  console.log("Name / symbol / decimals:", cfg.stablecoin.name, cfg.stablecoin.symbol, cfg.stablecoin.decimals);
  console.log("Mint (will be assigned on-chain):", cfg.stablecoin.mint || "(empty)");
  console.log("");
  console.log("Authorities:");
  console.log("  mint:", cfg.authorities.mint);
  console.log("  freeze:", cfg.authorities.freeze);
  console.log("  metadata:", cfg.authorities.metadata);
  if (cfg.authorities.permanentDelegate) {
    console.log("  permanentDelegate:", cfg.authorities.permanentDelegate);
  }
  if (cfg.authorities.pause) {
    console.log("  pause:", cfg.authorities.pause);
  }
  console.log("");
  console.log("Extensions:");
  const ex = cfg.extensions || {};
  console.log("  metadata:", ex.metadata?.enabled ?? false);
  console.log("  pausable:", ex.pausable?.enabled ?? false);
  console.log("  permanentDelegate:", ex.permanentDelegate?.enabled ?? false);
  console.log(
    "  transferHook:",
    ex.transferHook?.enabled ?? false,
    ex.transferHook?.enabled ? `programId=${ex.transferHook.programId}` : "",
  );
  console.log("");
  console.log(
    "[TODO] On-chain deployment not implemented yet. This is a configuration dry run.",
  );

  return cfg;
}

