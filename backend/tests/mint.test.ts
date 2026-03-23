import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import { buildTestApp } from "./helpers";

describe("Mint & burn routes", () => {
  const { app } = buildTestApp();
  const recipient = Keypair.generate().publicKey.toBase58();

  describe("POST /api/v1/mint", () => {
    it("mints tokens and returns tx signature", async () => {
      const res = await request(app)
        .post("/api/v1/mint")
        .send({ recipient, amount: "1000000" });
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-mint-sig");
    });

    it("rejects when recipient is missing", async () => {
      const res = await request(app)
        .post("/api/v1/mint")
        .send({ amount: "1000000" });
      expect(res.status).to.equal(400);
    });

    it("rejects when amount is missing", async () => {
      const res = await request(app)
        .post("/api/v1/mint")
        .send({ recipient });
      expect(res.status).to.equal(400);
    });

    it("rejects invalid public key", async () => {
      const res = await request(app)
        .post("/api/v1/mint")
        .send({ recipient: "not-a-key", amount: "100" });
      expect(res.status).to.equal(400);
      expect(res.body.error).to.include("Invalid");
    });
  });

  describe("POST /api/v1/burn", () => {
    it("burns tokens and returns tx signature", async () => {
      const res = await request(app)
        .post("/api/v1/burn")
        .send({ amount: "500000" });
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-burn-sig");
    });

    it("rejects when amount is missing", async () => {
      const res = await request(app)
        .post("/api/v1/burn")
        .send({});
      expect(res.status).to.equal(400);
    });
  });

  describe("GET /api/v1/supply", () => {
    it("returns supply info", async () => {
      const res = await request(app).get("/api/v1/supply");
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property("raw");
      expect(res.body).to.have.property("uiAmount");
      expect(res.body).to.have.property("decimals");
    });
  });

  describe("GET /api/v1/balance/:wallet", () => {
    it("returns balance for a wallet", async () => {
      const wallet = Keypair.generate().publicKey.toBase58();
      const res = await request(app).get(`/api/v1/balance/${wallet}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property("raw");
      expect(res.body).to.have.property("uiAmount");
      expect(res.body).to.have.property("ata");
      expect(res.body).to.have.property("exists");
    });

    it("rejects invalid wallet key", async () => {
      const res = await request(app).get("/api/v1/balance/not-a-key");
      expect(res.status).to.equal(400);
    });
  });
});
