import { Keypair, PublicKey } from "@solana/web3.js";
import type { AppDependencies } from "../src/app";
import { createApp } from "../src/app";
import { WebhookStore } from "../src/store";
import { createLogger } from "../src/logger";
import type { AppConfig } from "../src/config";
import type { SolanaContext } from "../src/solana";

const dummyMint = Keypair.generate().publicKey;
const dummyAuthority = Keypair.generate();

function mockStablecoin(): any {
  return {
    mint: dummyMint,
    tokenProgramId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    connection: {
      getVersion: async () => ({ "solana-core": "1.0.0", "feature-set": 1 }),
      getSignaturesForAddress: async () => [],
    },
    compliance: {
      blacklistAdd: async (_w: PublicKey, _a: Keypair) => "mock-bl-add-sig",
      blacklistRemove: async (_w: PublicKey, _a: Keypair) => "mock-bl-rm-sig",
      isBlacklisted: async (w: PublicKey) => ({
        wallet: w,
        pda: Keypair.generate().publicKey,
        blocked: false,
      }),
    },
    mintTokens: async () => "mock-mint-sig",
    burn: async () => "mock-burn-sig",
    freeze: async () => "mock-freeze-sig",
    thaw: async () => "mock-thaw-sig",
    setAuthority: async () => "mock-auth-sig",
    getSupply: async () => ({ raw: 1000000n, uiAmount: 1.0, decimals: 6 }),
    getBalance: async (_wallet: PublicKey) => ({
      raw: 500000n,
      uiAmount: 0.5,
      ata: Keypair.generate().publicKey,
      exists: true,
    }),
    getStatus: async () => ({
      mint: dummyMint,
      supply: { raw: 1000000n, uiAmount: 1.0, decimals: 6 },
      mintAuthority: dummyAuthority.publicKey,
      freezeAuthority: dummyAuthority.publicKey,
    }),
    getAuditLog: async () => [
      {
        signature: "abc123",
        slot: 100,
        err: null,
        blockTime: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  };
}

export function buildTestApp() {
  const config: AppConfig = {
    port: 0,
    logLevel: "silent",
    solanaRpcUrl: "http://localhost:8899",
    mintAddress: dummyMint.toBase58(),
    tokenProgram: "spl-token-2022",
    keypairPath: null,
    keypairBase64: null,
    transferHookProgramId: Keypair.generate().publicKey.toBase58(),
    blacklistKeypairPath: null,
    blacklistKeypairBase64: null,
    eventPollIntervalMs: 999999,
    webhookMaxRetries: 2,
    webhookRetryBaseMs: 50,
  };

  const ctx: SolanaContext = {
    connection: mockStablecoin().connection as any,
    stablecoin: mockStablecoin() as any,
    authority: dummyAuthority,
    blacklistAdmin: dummyAuthority,
  };

  const webhookStore = new WebhookStore();
  const logger = createLogger("silent");

  const inst = createApp({ config, ctx, webhookStore, logger });
  return { app: inst.expressApp, webhookStore, ctx, config, ...inst };
}

export { dummyMint, dummyAuthority };
