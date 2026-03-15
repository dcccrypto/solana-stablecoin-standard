import { describe, it, expect } from "vitest";
import { SSSClient } from "../../src/client";
import { SSSError } from "../../src/error";
import { BASE_URL } from "./setup";

describe("Integration: auth error paths", () => {
  it("rejects requests with invalid API key", async () => {
    const bad = new SSSClient(BASE_URL, "sss_totally_bogus_key_000000000");
    try {
      await bad.getSupply();
      expect.fail("Expected SSSError");
    } catch (err) {
      expect(err).toBeInstanceOf(SSSError);
      expect((err as SSSError).statusCode).toBe(401);
    }
  });

  it("rejects requests with empty API key", async () => {
    const empty = new SSSClient(BASE_URL, "");
    try {
      await empty.getSupply();
      expect.fail("Expected SSSError");
    } catch (err) {
      expect(err).toBeInstanceOf(SSSError);
      // Empty key → treated as invalid/missing
      expect((err as SSSError).statusCode).toBeLessThanOrEqual(401);
    }
  });
});
