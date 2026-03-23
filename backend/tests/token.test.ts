import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import request from "supertest";
import { buildTestApp, dummyMint, dummyAuthority } from "./helpers";

describe("Token routes", () => {
  const { app } = buildTestApp();

  describe("GET /api/v1/status", () => {
    it("returns token status", async () => {
      const res = await request(app).get("/api/v1/status");
      expect(res.status).to.equal(200);
      expect(res.body.mint).to.equal(dummyMint.toBase58());
      expect(res.body.supply).to.have.property("raw");
      expect(res.body.mintAuthority).to.equal(dummyAuthority.publicKey.toBase58());
    });
  });

  describe("POST /api/v1/freeze", () => {
    it("freezes a token account", async () => {
      const res = await request(app)
        .post("/api/v1/freeze")
        .send({ tokenAccount: Keypair.generate().publicKey.toBase58() });
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-freeze-sig");
    });

    it("rejects when tokenAccount is missing", async () => {
      const res = await request(app).post("/api/v1/freeze").send({});
      expect(res.status).to.equal(400);
    });
  });

  describe("POST /api/v1/thaw", () => {
    it("thaws a token account", async () => {
      const res = await request(app)
        .post("/api/v1/thaw")
        .send({ tokenAccount: Keypair.generate().publicKey.toBase58() });
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-thaw-sig");
    });
  });

  describe("POST /api/v1/set-authority", () => {
    it("changes authority", async () => {
      const newAuth = Keypair.generate().publicKey.toBase58();
      const res = await request(app)
        .post("/api/v1/set-authority")
        .send({ type: "freeze", newAuthority: newAuth });
      expect(res.status).to.equal(200);
      expect(res.body.txSignature).to.equal("mock-auth-sig");
    });

    it("rejects when type is missing", async () => {
      const res = await request(app)
        .post("/api/v1/set-authority")
        .send({ newAuthority: Keypair.generate().publicKey.toBase58() });
      expect(res.status).to.equal(400);
    });
  });

  describe("GET /api/v1/audit-log", () => {
    it("returns on-chain audit log entries", async () => {
      const res = await request(app).get("/api/v1/audit-log");
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an("array");
      expect(res.body[0]).to.have.property("signature");
    });
  });
});
