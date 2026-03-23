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
   * Optional URI for Token-2022 metadata (e.g. JSON or info page).
   */
  uri?: string;
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
  /**
   * Optional keypair JSON path for the blacklist admin (SSS-2 / transfer hook).
   */
  blacklist?: string;
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
  /**
   * SSS-Core on-chain program ID. When set, the CLI routes mint/burn/freeze/thaw/seize/pause
   * through the sss-core RBAC program instead of directly through Token-2022.
   */
  ssCoreProgramId?: string;
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

/**
 * Updates the stablecoin mint address in a TOML config file (in place).
 * Use after deploying a new mint so the config points to the on-chain mint.
 */
export function updateConfigMint(
  configPath: string,
  mintAddress: string,
): void {
  const filePath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found at ${filePath}`);
  }
  let raw = fs.readFileSync(filePath, "utf8");
  raw = raw.replace(/mint\s*=\s*"[^"]*"/, `mint = "${mintAddress}"`);
  fs.writeFileSync(filePath, raw, { encoding: "utf8" });
}

export function writeDefaultConfig(
  preset: SssStandard,
  outPath?: string,
): string {
  const filePath = outPath
    ? path.resolve(process.cwd(), outPath)
    : defaultConfigPath();

  const isSss2 = preset === "sss-2";

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
# Optional: permanent delegate and pause authority
# permanentDelegate = ""
# pause = ""
${isSss2
    ? '# Blacklist admin authority (required for SSS-2)\nblacklist = "~/.config/solana/id.json"'
    : '# blacklist = "" # SSS-2 only: blacklist admin authority'}

# SSS-Core program ID — when set, CLI routes operations through RBAC
# ssCoreProgramId = "4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD"

# Extensions configuration

[extensions.metadata]
# Metadata is required so wallets and explorers can display the token properly.
enabled = true

[extensions.pausable]
# Optional: allow pausing all token activity.
enabled = false

[extensions.permanentDelegate]
# Optional: grant a permanent delegate power over transfers.
enabled = false

[extensions.transferHook]
# Route transfers through a custom hook program (e.g. blacklist).
${isSss2
    ? '# SSS-2: Transfer hook is required for blacklist enforcement.\nenabled = true\n# Set this to your deployed blacklist_hook program ID before running init --custom.\nprogramId = ""'
    : 'enabled = false\nprogramId = ""'}
`.trimStart();

  fs.writeFileSync(filePath, content, { encoding: "utf8" });
  return filePath;
}

