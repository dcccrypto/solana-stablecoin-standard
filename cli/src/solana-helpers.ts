import fs from "fs";
import path from "path";
import { Connection, Keypair } from "@solana/web3.js";
import type { SssConfig } from "./config";

const CLUSTER_ENDPOINTS: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet.solana.com",
};

/**
 * Resolves a path that may start with ~ to the user's home directory.
 */
export function resolveKeypairPath(rawPath: string): string {
  const expanded =
    rawPath.startsWith("~") && process.env.HOME
      ? path.join(process.env.HOME, rawPath.slice(1))
      : rawPath;
  return path.resolve(process.cwd(), expanded);
}

/**
 * Loads a keypair from a JSON file (Solana keypair format).
 */
export function loadKeypair(keypairPath: string): Keypair {
  const resolved = resolveKeypairPath(keypairPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair file not found: ${resolved}`);
  }
  const data = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const secret = Uint8Array.from(data);
  return Keypair.fromSecretKey(secret);
}

/**
 * Builds an RPC URL from config: explicit rpcUrl or cluster default.
 */
export function getRpcUrl(cfg: SssConfig): string {
  if (cfg.rpcUrl && cfg.rpcUrl.trim() !== "") {
    return cfg.rpcUrl.trim();
  }
  const endpoint = CLUSTER_ENDPOINTS[cfg.cluster];
  if (endpoint) return endpoint;
  throw new Error(`Unknown cluster "${cfg.cluster}" and no rpcUrl set`);
}

/**
 * Creates a Connection from config.
 */
export function getConnection(cfg: SssConfig): Connection {
  return new Connection(getRpcUrl(cfg), "confirmed");
}
