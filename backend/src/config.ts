import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val || val.trim() === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val.trim();
}

function optional(key: string, fallback: string): string {
  const val = process.env[key];
  return val && val.trim() !== "" ? val.trim() : fallback;
}

export interface AppConfig {
  port: number;
  logLevel: string;

  solanaRpcUrl: string;
  mintAddress: string;
  tokenProgram: string;
  keypairPath: string | null;
  keypairBase64: string | null;

  transferHookProgramId: string | null;
  blacklistKeypairPath: string | null;
  blacklistKeypairBase64: string | null;

  eventPollIntervalMs: number;
  webhookMaxRetries: number;
  webhookRetryBaseMs: number;
}

export function loadAppConfig(): AppConfig {
  return {
    port: Number(optional("PORT", "3000")),
    logLevel: optional("LOG_LEVEL", "info"),

    solanaRpcUrl: required("SOLANA_RPC_URL"),
    mintAddress: required("SOLANA_MINT_ADDRESS"),
    tokenProgram: optional("TOKEN_PROGRAM", "spl-token-2022"),
    keypairPath: process.env.SOLANA_KEYPAIR_PATH?.trim() || null,
    keypairBase64: process.env.SOLANA_KEYPAIR_BASE64?.trim() || null,

    transferHookProgramId: process.env.TRANSFER_HOOK_PROGRAM_ID?.trim() || null,
    blacklistKeypairPath: process.env.BLACKLIST_ADMIN_KEYPAIR_PATH?.trim() || null,
    blacklistKeypairBase64: process.env.BLACKLIST_ADMIN_KEYPAIR_BASE64?.trim() || null,

    eventPollIntervalMs: Number(optional("EVENT_POLL_INTERVAL_MS", "5000")),
    webhookMaxRetries: Number(optional("WEBHOOK_MAX_RETRIES", "5")),
    webhookRetryBaseMs: Number(optional("WEBHOOK_RETRY_BASE_MS", "1000")),
  };
}
