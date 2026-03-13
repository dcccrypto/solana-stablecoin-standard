import { describe, it, expect } from "vitest";
import { SSSClient } from "../../src/client";
import { BASE_URL, API_KEY } from "./setup";

describe("Integration: health", () => {
  const client = new SSSClient(BASE_URL, API_KEY);

  it("health() returns status ok", async () => {
    const data = await client.health();
    expect(data.status).toBe("ok");
    expect(data.version).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });
});
