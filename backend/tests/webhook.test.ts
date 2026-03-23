import { expect } from "chai";
import request from "supertest";
import { buildTestApp } from "./helpers";

describe("Webhook routes", () => {
  const { app } = buildTestApp();
  let webhookId: string;

  describe("POST /api/v1/webhooks", () => {
    it("registers a webhook", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/hook", events: ["transaction.confirmed"], secret: "s3cret" });
      expect(res.status).to.equal(201);
      expect(res.body).to.have.property("id");
      expect(res.body.url).to.equal("https://example.com/hook");
      expect(res.body.events).to.deep.equal(["transaction.confirmed"]);
      expect(res.body.active).to.equal(true);
      webhookId = res.body.id;
    });

    it("rejects when url is missing", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ events: ["*"] });
      expect(res.status).to.equal(400);
    });

    it("rejects when events is missing", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/hook" });
      expect(res.status).to.equal(400);
    });

    it("rejects invalid url", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "not-a-url", events: ["*"] });
      expect(res.status).to.equal(400);
    });
  });

  describe("GET /api/v1/webhooks", () => {
    it("lists registered webhooks", async () => {
      const res = await request(app).get("/api/v1/webhooks");
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an("array");
      expect(res.body.length).to.be.greaterThan(0);
    });
  });

  describe("GET /api/v1/webhooks/:id", () => {
    it("returns a specific webhook", async () => {
      const res = await request(app).get(`/api/v1/webhooks/${webhookId}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(webhookId);
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app).get("/api/v1/webhooks/nonexistent");
      expect(res.status).to.equal(404);
    });
  });

  describe("GET /api/v1/webhooks/:id/deliveries", () => {
    it("returns delivery history for a webhook", async () => {
      const res = await request(app).get(`/api/v1/webhooks/${webhookId}/deliveries`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an("array");
    });
  });

  describe("DELETE /api/v1/webhooks/:id", () => {
    it("deletes a webhook", async () => {
      const res = await request(app).delete(`/api/v1/webhooks/${webhookId}`);
      expect(res.status).to.equal(200);
      expect(res.body.deleted).to.equal(true);
    });

    it("returns 404 for already-deleted webhook", async () => {
      const res = await request(app).delete(`/api/v1/webhooks/${webhookId}`);
      expect(res.status).to.equal(404);
    });
  });
});
