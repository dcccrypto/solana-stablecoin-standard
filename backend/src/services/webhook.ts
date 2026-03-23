import { v4 as uuid } from "uuid";
import type { WebhookStore } from "../store";
import type pino from "pino";
import type { WebhookConfig, WebhookDelivery } from "../types";

export class WebhookService {
  constructor(
    private store: WebhookStore,
    private logger: pino.Logger,
    private maxRetries: number,
    private retryBaseMs: number,
  ) {}

  register(url: string, events: string[], secret?: string): WebhookConfig {
    const wh: WebhookConfig = {
      id: uuid(),
      url,
      events,
      secret,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.store.addWebhook(wh);
    this.logger.info({ webhookId: wh.id, url, events }, "Webhook registered");
    return wh;
  }

  list(): WebhookConfig[] {
    return this.store.getWebhooks();
  }

  get(id: string): WebhookConfig | undefined {
    return this.store.getWebhook(id);
  }

  remove(id: string): boolean {
    const ok = this.store.removeWebhook(id);
    if (ok) this.logger.info({ webhookId: id }, "Webhook removed");
    return ok;
  }

  /**
   * Dispatch an event to all webhooks that subscribe to it.
   * Retries with exponential backoff on failure.
   */
  async dispatch(event: string, payload: unknown): Promise<void> {
    const hooks = this.store.getWebhooks().filter(
      (wh) => wh.active && (wh.events.includes("*") || wh.events.includes(event)),
    );

    for (const wh of hooks) {
      this.deliverWithRetry(wh, event, payload).catch((err) => {
        this.logger.error({ webhookId: wh.id, err }, "Webhook delivery ultimately failed");
      });
    }
  }

  private async deliverWithRetry(
    wh: WebhookConfig,
    event: string,
    payload: unknown,
  ): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const delivery: WebhookDelivery = {
        webhookId: wh.id,
        event,
        payload,
        attempt,
        status: "pending",
        timestamp: new Date().toISOString(),
      };

      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (wh.secret) headers["x-webhook-secret"] = wh.secret;

        const resp = await fetch(wh.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, payload, timestamp: delivery.timestamp }),
          signal: AbortSignal.timeout(10_000),
        });

        delivery.httpStatus = resp.status;
        delivery.status = resp.ok ? "delivered" : "failed";
        this.store.addDelivery(delivery);

        if (resp.ok) {
          this.logger.debug({ webhookId: wh.id, event, attempt }, "Webhook delivered");
          return;
        }
      } catch (err) {
        delivery.status = "failed";
        delivery.error = err instanceof Error ? err.message : String(err);
        this.store.addDelivery(delivery);
      }

      if (attempt < this.maxRetries) {
        const delayMs = this.retryBaseMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  getDeliveries(webhookId?: string): WebhookDelivery[] {
    return this.store.getDeliveries(webhookId);
  }
}
