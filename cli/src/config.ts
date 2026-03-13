import fs from "fs";
import path from "path";
import toml from "toml";

export type SssStandard = "sss-1" | "sss-2";

export type Cluster = "devnet" | "testnet" | "mainnet-beta" | string;

export type TokenProgramKind = "spl-token" | "spl-token-2022";

export interface StablecoinSection {
  name: string;
  symbol: string;
  decimals: number;
  tokenProgram: TokenProgramKind;
  /**
   * Mint address of the stablecoin SPL token.
   * For "no stablecoin yet" flows, this starts empty and is filled after deploy.
   */
  mint: string;
}

export interface AuthoritiesSection {
  /**
   * Keypair JSON path for the mint authority.
   */
  mint: string;
  /**
   * Keypair JSON path for the freeze authority.
   */
  freeze: string;
  /**
   * Keypair JSON path for the metadata authority.
   */
  metadata: string;
  /**
   * Optional keypair JSON path for a permanent delegate authority.
   */
  permanentDelegate?: string;
  /**
   * Optional keypair JSON path for a pause authority (Pausable extension).
   */
  pause?: string;
}

export interface MetadataExtensionConfig {
  enabled: boolean;
}

export interface PausableExtensionConfig {
  enabled: boolean;
}

export interface PermanentDelegateExtensionConfig {
  enabled: boolean;
}

export interface TransferHookExtensionConfig {
  enabled: boolean;
  /**
   * Program ID implementing the transfer hook interface.
   */
  programId: string;
}

export interface ExtensionsSection {
  /**
   * Token-2022 Metadata extension; for SSS-1, this is required and enabled.
   */
  metadata?: MetadataExtensionConfig;
  /**
   * Token-2022 Pausable extension.
   */
  pausable?: PausableExtensionConfig;
  /**
   * Token-2022 Permanent Delegate extension.
   */
  permanentDelegate?: PermanentDelegateExtensionConfig;
  /**
   * Token-2022 Transfer Hook extension (e.g. for blacklist logic).
   */
  transferHook?: TransferHookExtensionConfig;
}

export interface SssConfig {
  /**
   * Which SSS profile this mint is intended to comply with.
   */
  standard: SssStandard;
  /**
   * Which cluster to target (devnet, testnet, mainnet-beta, or custom).
   */
  cluster: Cluster;
  /**
   * Optional explicit RPC URL; otherwise cluster default is used.
   */
  rpcUrl?: string;
  /**
   * Stablecoin-level properties.
   */
  stablecoin: StablecoinSection;
  /**
   * Authority keypairs for this mint and its extensions.
   */
  authorities: AuthoritiesSection;
  /**
   * Enabled token extensions and their parameters.
   */
  extensions?: ExtensionsSection;
}

export function defaultConfigPath(): string {
  return path.resolve(process.cwd(), "sss-token.config.toml");
}

export function loadConfig(configPath?: string): SssConfig {
  const filePath = configPath
    ? path.resolve(process.cwd(), configPath)
    : defaultConfigPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = toml.parse(raw) as unknown;

  const cfg = parsed as SssConfig;

  if (cfg.standard !== "sss-1" && cfg.standard !== "sss-2") {
    throw new Error(`Unsupported standard "${(cfg as any).standard}" in config`);
  }

  if (!cfg.stablecoin || !cfg.stablecoin.name || !cfg.stablecoin.symbol) {
    throw new Error("Config must define [stablecoin] name and symbol");
  }

  if (!cfg.authorities || !cfg.authorities.mint || !cfg.authorities.freeze) {
    throw new Error(
      "Config must define [authorities] with at least mint and freeze keypair paths",
    );
  }

  return cfg;
}

export function writeDefaultConfig(
  preset: SssStandard,
  outPath?: string,
): string {
  const filePath = outPath
    ? path.resolve(process.cwd(), outPath)
    : defaultConfigPath();

  const content = `
# Solana Stablecoin Standard config
# Preset: ${preset}
standard = "${preset}"
cluster = "devnet"
rpcUrl = ""

[stablecoin]
# Human-readable token metadata
name = "My Stablecoin"
symbol = "MUSD"
decimals = 6
# Use "spl-token-2022" for Token Extensions support
tokenProgram = "spl-token-2022"
# Will be filled after deployment by sss-token init
mint = ""

[authorities]
# Paths to keypair JSON files for mint / freeze / metadata authorities
mint = "~/.config/solana/id.json"
freeze = "~/.config/solana/id.json"
metadata = "~/.config/solana/id.json"
# Optional: permanent delegate and pause authority (unused in SSS-1 preset)
# permanentDelegate = ""
# pause = ""

# Extensions configuration

[extensions.metadata]
# SSS-1: Metadata is required so wallets and explorers can display the token properly.
enabled = true

[extensions.pausable]
# Optional: allow pausing all token activity. Disabled in SSS-1 preset.
enabled = false

[extensions.permanentDelegate]
# Optional: grant a permanent delegate power over transfers. Disabled in SSS-1 preset.
enabled = false

[extensions.transferHook]
# Optional: route transfers through a custom hook program (e.g. blacklist). Disabled in SSS-1 preset.
enabled = false
programId = ""
`.trimStart();

  fs.writeFileSync(filePath, content, { encoding: "utf8" });
  return filePath;
}

