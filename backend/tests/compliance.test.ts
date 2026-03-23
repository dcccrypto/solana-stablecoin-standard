import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import { buildTestApp } from "./helpers";

describe("Compliance routes", () => {
  const { app } = buildTestApp();
  const wallet = Keypair.generate().publicKey.toBase58();

  describe("POST /api/v1/compliance/blacklist", () => {
    it("adds wallet to blacklist", async () => {
      const res = await request(app)
        .post("/api/v1/compliance/blacklist")
        .send({ wallet, reason: "OFAC match" });
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-bl-add-sig");
    });

    it("rejects when wallet is missing", async () => {
      const res = await request(app)
        .post("/api/v1/compliance/blacklist")
        .send({});
      expect(res.status).to.equal(400);
    });

    it("rejects invalid wallet", async () => {
      const res = await request(app)
        .post("/api/v1/compliance/blacklist")
        .send({ wallet: "bad-key" });
      expect(res.status).to.equal(400);
      expect(res.body.error).to.include("Invalid");
    });
  });

  describe("DELETE /api/v1/compliance/blacklist/:wallet", () => {
    it("removes wallet from blacklist", async () => {
      const res = await request(app)
        .delete(`/api/v1/compliance/blacklist/${wallet}`);
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-bl-rm-sig");
    });
  });

  describe("GET /api/v1/compliance/blacklist/:wallet", () => {
    it("checks blacklist status", async () => {
      const res = await request(app)
        .get(`/api/v1/compliance/blacklist/${wallet}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property("wallet");
      expect(res.body).to.have.property("blocked");
      expect(res.body.blocked).to.equal(false);
    });
  });
});
