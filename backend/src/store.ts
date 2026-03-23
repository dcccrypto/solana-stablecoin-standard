import type { WebhookConfig, WebhookDelivery } from "./types";

/**
 * Lightweight in-memory registry for webhook subscriptions and delivery
 * tracking. All token data lives on-chain — this only holds runtime config
 * that has no blockchain equivalent.
 */
export class WebhookStore {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveries: WebhookDelivery[] = [];

  addWebhook(wh: WebhookConfig): void {
    this.webhooks.set(wh.id, wh);
  }

  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks.values()];
  }

  getWebhook(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  removeWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  addDelivery(d: WebhookDelivery): void {
    this.deliveries.push(d);
  }

  getDeliveries(webhookId?: string): WebhookDelivery[] {
    let out = [...this.deliveries].reverse();
    if (webhookId) out = out.filter((d) => d.webhookId === webhookId);
    return out;
  }
}
