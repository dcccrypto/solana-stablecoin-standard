import { expect } from "chai";
import { WebhookStore } from "../src/store";

describe("WebhookStore", () => {
  let store: WebhookStore;

  beforeEach(() => {
    store = new WebhookStore();
  });

  it("adds and lists webhooks", () => {
    store.addWebhook({
      id: "w1", url: "https://example.com", events: ["*"],
      active: true, createdAt: "",
    });
    expect(store.getWebhooks()).to.have.length(1);
  });

  it("retrieves a webhook by id", () => {
    store.addWebhook({
      id: "w1", url: "https://example.com", events: ["*"],
      active: true, createdAt: "",
    });
    expect(store.getWebhook("w1")?.url).to.equal("https://example.com");
    expect(store.getWebhook("w999")).to.be.undefined;
  });

  it("removes a webhook", () => {
    store.addWebhook({
      id: "w1", url: "https://example.com", events: ["*"],
      active: true, createdAt: "",
    });
    expect(store.removeWebhook("w1")).to.equal(true);
    expect(store.getWebhooks()).to.have.length(0);
    expect(store.removeWebhook("w1")).to.equal(false);
  });

  it("tracks deliveries", () => {
    store.addDelivery({
      webhookId: "w1", event: "transaction.confirmed",
      payload: {}, attempt: 1, status: "delivered", timestamp: "",
    });
    store.addDelivery({
      webhookId: "w2", event: "transaction.confirmed",
      payload: {}, attempt: 1, status: "failed", timestamp: "",
    });
    expect(store.getDeliveries()).to.have.length(2);
    expect(store.getDeliveries("w1")).to.have.length(1);
  });
});
