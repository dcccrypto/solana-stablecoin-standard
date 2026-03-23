import express from "express";
import cors from "cors";
import helmet from "helmet";
import type pino from "pino";
import type { SolanaContext } from "./solana";
import type { WebhookStore } from "./store";
import type { AppConfig } from "./config";

import { errorHandler } from "./middleware/error-handler";

import { MintBurnService } from "./services/mint-burn";
import { ComplianceService } from "./services/compliance";
import { WebhookService } from "./services/webhook";
import { EventListener } from "./services/event-listener";

import { healthRoutes } from "./routes/health";
import { mintRoutes } from "./routes/mint";
import { tokenRoutes } from "./routes/token";
import { complianceRoutes } from "./routes/compliance";
import { webhookRoutes } from "./routes/webhooks";

export interface AppDependencies {
  config: AppConfig;
  ctx: SolanaContext;
  webhookStore: WebhookStore;
  logger: pino.Logger;
}

export interface AppInstance {
  expressApp: express.Application;
  eventListener: EventListener;
  webhookService: WebhookService;
  mintBurnService: MintBurnService;
  complianceService: ComplianceService;
}

export function createApp(deps: AppDependencies): AppInstance {
  const { config, ctx, webhookStore, logger } = deps;
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, "request");
    next();
  });

  const mintBurnService = new MintBurnService(ctx, logger);
  const complianceService = new ComplianceService(ctx, logger);
  const webhookService = new WebhookService(webhookStore, logger, config.webhookMaxRetries, config.webhookRetryBaseMs);
  const eventListener = new EventListener(ctx, webhookService, logger, config.eventPollIntervalMs);

  app.use(healthRoutes(ctx));
  app.use(mintRoutes(ctx, mintBurnService));
  app.use(tokenRoutes(ctx));
  app.use(complianceRoutes(complianceService));
  app.use(webhookRoutes(webhookService));

  app.use(errorHandler(logger));

  return { expressApp: app, eventListener, webhookService, mintBurnService, complianceService };
}
