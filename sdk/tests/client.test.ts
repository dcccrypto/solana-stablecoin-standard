import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSSClient } from "../src/client.js";
import { SSSError } from "../src/error.js";
import type { ApiResponse, HealthData, MintEvent, SupplyResponse } from "../src/types.js";

const BASE_URL = "http://localhost:8080";
const API_KEY = "sss_testkey000000000000000000000000000000000000000000";

function mockFetch(response: ApiResponse<unknown>, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  });
}

describe("SSSClient", () => {
  const client = new SSSClient(BASE_URL, API_KEY);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── health ──────────────────────────────────────────────────────────────

  it("health() returns HealthData on success", async () => {
    const data: HealthData = {
      status: "ok",
      version: "0.1.0",
      timestamp: "2026-03-13T19:00:00Z",
    };
    vi.stubGlobal("fetch", mockFetch({ success: true, data, error: null }));

    const result = await client.health();
    expect(result.status).toBe("ok");
    expect(result.version).toBe("0.1.0");
  });

  it("health() throws SSSError on non-success envelope", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ success: false, data: null, error: "Service unavailable" }, 503)
    );

    await expect(client.health()).rejects.toThrow(SSSError);
    await expect(client.health()).rejects.toThrow("Service unavailable");
  });

  // ─── mint ────────────────────────────────────────────────────────────────

  it("mint() returns MintEvent on success", async () => {
    const data: MintEvent = {
      id: "abc-123",
      token_mint: "TokenMint111111111111111111111111111111111",
      amount: 1_000_000,
      recipient: "Recipient111111111111111111111111111111111",
      tx_signature: null,
      created_at: "2026-03-13T19:00:00Z",
    };
    vi.stubGlobal("fetch", mockFetch({ success: true, data, error: null }));

    const result = await client.mint({
      token_mint: data.token_mint,
      amount: data.amount,
      recipient: data.recipient,
    });

    expect(result.id).toBe("abc-123");
    expect(result.amount).toBe(1_000_000);
  });

  it("mint() throws SSSError when recipient is blacklisted", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          success: false,
          data: null,
          error: "Recipient Blacklisted111 is blacklisted",
        },
        400
      )
    );

    await expect(
      client.mint({
        token_mint: "TokenMint111111111111111111111111111111111",
        amount: 1_000_000,
        recipient: "Blacklisted111",
      })
    ).rejects.toMatchObject({
      message: "Recipient Blacklisted111 is blacklisted",
      statusCode: 400,
    });
  });

  it("mint() SSSError carries the correct statusCode", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ success: false, data: null, error: "Unauthorized" }, 401)
    );

    let caught: SSSError | undefined;
    try {
      await client.mint({
        token_mint: "T",
        amount: 1,
        recipient: "R",
      });
    } catch (e) {
      caught = e as SSSError;
    }

    expect(caught).toBeInstanceOf(SSSError);
    expect(caught?.statusCode).toBe(401);
    expect(caught?.message).toBe("Unauthorized");
  });

  // ─── getSupply ───────────────────────────────────────────────────────────

  it("getSupply() without filter calls correct URL", async () => {
    const fetchSpy = mockFetch({
      success: true,
      data: {
        token_mint: "",
        total_minted: 5000,
        total_burned: 1000,
        circulating_supply: 4000,
      } as SupplyResponse,
      error: null,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await client.getSupply();
    expect(result.circulating_supply).toBe(4000);

    const calledUrl = (fetchSpy.mock.calls[0] as [string])[0];
    expect(calledUrl).toBe(`${BASE_URL}/api/supply`);
  });

  it("getSupply() with tokenMint appends query param", async () => {
    const mint = "TokenMint111";
    const fetchSpy = mockFetch({
      success: true,
      data: {
        token_mint: mint,
        total_minted: 100,
        total_burned: 10,
        circulating_supply: 90,
      } as SupplyResponse,
      error: null,
    });
    vi.stubGlobal("fetch", fetchSpy);

    await client.getSupply(mint);
    const calledUrl = (fetchSpy.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain(`token_mint=${encodeURIComponent(mint)}`);
  });

  // ─── SSSError ────────────────────────────────────────────────────────────

  it("SSSError is instanceof SSSError", () => {
    const err = new SSSError("test", 404);
    expect(err).toBeInstanceOf(SSSError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SSSError");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("test");
  });
});
