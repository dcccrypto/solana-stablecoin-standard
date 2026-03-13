import { describe, it, expect } from "vitest";
import { SSSClient } from "../../src/client";
import { BASE_URL, API_KEY } from "./setup";

describe("Integration: webhooks", () => {
  const client = new SSSClient(BASE_URL, API_KEY);
  let webhookId: string;

  it("addWebhook() registers a webhook", async () => {
    const entry = await client.addWebhook({
      url: "https://example.com/hook",
      events: ["mint", "burn"],
    });
    expect(entry.id).toBeDefined();
    expect(entry.url).toBe("https://example.com/hook");
    expect(entry.events).toEqual(["mint", "burn"]);
    webhookId = entry.id;
  });

  it("getWebhooks() lists registered webhooks", async () => {
    const list = await client.getWebhooks();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((w) => w.id === webhookId);
    expect(found).toBeDefined();
    expect(found!.url).toBe("https://example.com/hook");
  });

  it("deleteWebhook() removes a webhook", async () => {
    const result = await client.deleteWebhook(webhookId);
    expect(result.deleted).toBe(true);
    expect(result.id).toBe(webhookId);
  });

  it("getWebhooks() no longer includes the deleted webhook", async () => {
    const list = await client.getWebhooks();
    const found = list.find((w) => w.id === webhookId);
    expect(found).toBeUndefined();
  });
});
