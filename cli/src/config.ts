import fs from "fs";
import path from "path";
import toml from "toml";

export type SssStandard = "sss-1" | "sss-2";

export interface SssConfig {
  standard: SssStandard;
  cluster: "devnet" | "testnet" | "mainnet-beta" | string;
  rpcUrl?: string;
  stablecoinMint: string;
  authorityKeypairPath: string;
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

  return cfg;
}

export function writeDefaultConfig(
  preset: SssStandard,
  outPath?: string,
): string {
  const filePath = outPath
    ? path.resolve(process.cwd(), outPath)
    : defaultConfigPath();

  const base = [
    `standard = "${preset}"`,
    `cluster = "devnet"`,
    `rpcUrl = ""`,
    ``,
    `# TODO: fill with your deployed stablecoin mint address`,
    `stablecoinMint = ""`,
    ``,
    `# Path to the authority keypair JSON (mint / freeze authority etc.)`,
    `authorityKeypairPath = "~/.config/solana/id.json"`,
    ``,
  ];

  fs.writeFileSync(filePath, base.join("\n"), { encoding: "utf8" });
  return filePath;
}

