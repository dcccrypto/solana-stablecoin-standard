import { loadAppConfig } from "./config";
import { createLogger } from "./logger";
import { initSolana } from "./solana";
import { WebhookStore } from "./store";
import { createApp } from "./app";

async function main() {
  const config = loadAppConfig();
  const logger = createLogger(config.logLevel);
  const ctx = initSolana(config);
  const webhookStore = new WebhookStore();

  logger.info({
    mint: ctx.stablecoin.mint.toBase58(),
    authority: ctx.authority.publicKey.toBase58(),
    compliance: !!ctx.stablecoin.compliance,
  }, "Solana context initialized");

  const { expressApp, eventListener } = createApp({ config, ctx, webhookStore, logger });

  eventListener.start();

  const server = expressApp.listen(config.port, () => {
    logger.info({ port: config.port }, "SSS backend started");
  });

  const shutdown = () => {
    logger.info("Shutting down…");
    eventListener.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
