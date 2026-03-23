import { expect } from "chai";
import request from "supertest";
import { buildTestApp, dummyMint } from "./helpers";

describe("Health routes", () => {
  const { app } = buildTestApp();

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal("ok");
    expect(res.body).to.have.property("timestamp");
  });

  it("GET /ready returns Solana version and mint", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal("ready");
    expect(res.body.solana).to.have.property("solana-core");
    expect(res.body.mint).to.equal(dummyMint.toBase58());
  });
});
