import { describe, it, expect } from "vitest";
import { SSSClient } from "../../src/client";
import { SSSError } from "../../src/error";
import { BASE_URL, API_KEY } from "./setup";

describe("Integration: API key management", () => {
  const client = new SSSClient(BASE_URL, API_KEY);
  let newKeyId: string;
  let newKeyFull: string;

  it("createApiKey() returns a new key with id and full key", async () => {
    const entry = await client.createApiKey("integration-test-key");
    expect(entry.id).toBeDefined();
    expect(entry.key).toMatch(/^sss_/);
    expect(entry.label).toBe("integration-test-key");
    expect(entry.created_at).toBeDefined();
    newKeyId = entry.id;
    newKeyFull = entry.key;
  });

  it("listApiKeys() includes the new key (redacted)", async () => {
    const keys = await client.listApiKeys();
    expect(keys.length).toBeGreaterThanOrEqual(2); // bootstrap + new
    const found = keys.find((k) => k.id === newKeyId);
    expect(found).toBeDefined();
    expect(found!.label).toBe("integration-test-key");
    expect(found!.key_prefix).toBeDefined();
  });

  it("new key is usable for authenticated requests", async () => {
    const newClient = new SSSClient(BASE_URL, newKeyFull);
    const supply = await newClient.getSupply();
    expect(supply).toBeDefined();
    expect(supply.circulating_supply).toBeGreaterThanOrEqual(0);
  });

  it("deleteApiKey() revokes the key", async () => {
    const result = await client.deleteApiKey(newKeyId);
    expect(result.deleted).toBe(true);
  });

  it("deleted key is rejected on subsequent requests", async () => {
    const revokedClient = new SSSClient(BASE_URL, newKeyFull);
    try {
      await revokedClient.getSupply();
      expect.fail("Expected SSSError for revoked key");
    } catch (err) {
      expect(err).toBeInstanceOf(SSSError);
      expect((err as SSSError).statusCode).toBe(401);
    }
  });
});
