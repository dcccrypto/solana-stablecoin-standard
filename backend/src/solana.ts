import fs from "fs";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SolanaStablecoin } from "sss-token-sdk";
import type { AppConfig } from "./config";

function resolveKeypairPath(rawPath: string): string {
  const expanded =
    rawPath.startsWith("~") && process.env.HOME
      ? path.join(process.env.HOME, rawPath.slice(1))
      : rawPath;
  return path.resolve(expanded);
}

export function loadKeypair(filePath?: string | null, base64?: string | null): Keypair {
  if (base64) {
    const secret = Uint8Array.from(Buffer.from(base64, "base64"));
    return Keypair.fromSecretKey(secret);
  }
  if (filePath) {
    const resolved = resolveKeypairPath(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Keypair file not found: ${resolved}`);
    }
    const data = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  throw new Error("No keypair source provided (set SOLANA_KEYPAIR_PATH or SOLANA_KEYPAIR_BASE64).");
}

export interface SolanaContext {
  connection: Connection;
  stablecoin: SolanaStablecoin;
  authority: Keypair;
  blacklistAdmin: Keypair | null;
}

export function initSolana(cfg: AppConfig): SolanaContext {
  const connection = new Connection(cfg.solanaRpcUrl, "confirmed");

  const tokenProgramId =
    cfg.tokenProgram === "spl-token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const transferHookProgramId = cfg.transferHookProgramId
    ? new PublicKey(cfg.transferHookProgramId)
    : undefined;

  const stablecoin = SolanaStablecoin.load(connection, {
    mint: new PublicKey(cfg.mintAddress),
    tokenProgramId,
    transferHookProgramId,
  });

  const authority = loadKeypair(cfg.keypairPath, cfg.keypairBase64);

  let blacklistAdmin: Keypair | null = null;
  if (cfg.blacklistKeypairPath || cfg.blacklistKeypairBase64) {
    blacklistAdmin = loadKeypair(cfg.blacklistKeypairPath, cfg.blacklistKeypairBase64);
  } else if (transferHookProgramId) {
    blacklistAdmin = authority;
  }

  return { connection, stablecoin, authority, blacklistAdmin };
}
