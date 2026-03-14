import { describe, it, expect } from "vitest";
import { SSSClient } from "../../src/client";
import { SSSError } from "../../src/error";
import { BASE_URL, API_KEY, TOKEN_MINT } from "./setup";

// Use the shared TOKEN_MINT fixture — it is a valid base58 Solana pubkey
// seeded by the test backend, so compliance checks exercise real on-chain logic.
const COMPLIANCE_MINT = TOKEN_MINT;

describe("Integration: compliance (blacklist enforcement)", () => {
  const client = new SSSClient(BASE_URL, API_KEY);
  const BLOCKED_ADDR = "BlockedAddr" + Date.now().toString().slice(-30).padEnd(30, "0");

  it("getBlacklist() returns an array", async () => {
    const list = await client.getBlacklist();
    expect(Array.isArray(list)).toBe(true);
  });

  it("addToBlacklist() adds an address", async () => {
    const entry = await client.addToBlacklist({
      address: BLOCKED_ADDR,
      reason: "Integration test — sanctioned",
    });
    expect(entry.id).toBeDefined();
    expect(entry.address).toBe(BLOCKED_ADDR);
    expect(entry.reason).toBe("Integration test — sanctioned");
  });

  it("getBlacklist() includes the newly added address", async () => {
    const list = await client.getBlacklist();
    const found = list.find((e) => e.address === BLOCKED_ADDR);
    expect(found).toBeDefined();
  });

  it("mint() rejects blacklisted recipient with SSSError", async () => {
    try {
      await client.mint({
        token_mint: COMPLIANCE_MINT,
        amount: 100,
        recipient: BLOCKED_ADDR,
      });
      expect.fail("Expected SSSError but mint succeeded");
    } catch (err) {
      expect(err).toBeInstanceOf(SSSError);
      const sssErr = err as SSSError;
      expect(sssErr.statusCode).toBe(400);
      expect(sssErr.message).toContain("blacklisted");
    }
  });

  it("getAuditLog() records blacklist and blocked-mint events", async () => {
    const log = await client.getAuditLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    // Should find the BLACKLIST_ADD entry
    const addEntry = log.find(
      (e) => e.action === "BLACKLIST_ADD" && e.address === BLOCKED_ADDR
    );
    expect(addEntry).toBeDefined();
    // Should find the MINT_BLOCKED entry
    const blockEntry = log.find(
      (e) => e.action === "MINT_BLOCKED" && e.address === BLOCKED_ADDR
    );
    expect(blockEntry).toBeDefined();
  });

  it("removeFromBlacklist() removes the address", async () => {
    const list = await client.getBlacklist();
    const entry = list.find((e) => e.address === BLOCKED_ADDR)!;
    const result = await client.removeFromBlacklist(entry.id);
    expect(result.removed).toBe(true);
  });

  it("mint() succeeds for the un-blacklisted address", async () => {
    const event = await client.mint({
      token_mint: COMPLIANCE_MINT,
      amount: 100,
      recipient: BLOCKED_ADDR,
    });
    expect(event.id).toBeDefined();
    expect(event.amount).toBe(100);
  });
});
