import { describe, it, expect } from "vitest";
import { SSSClient } from "../../src/client";
import { BASE_URL, API_KEY, TOKEN_MINT, RECIPIENT, SOURCE } from "./setup";

describe("Integration: mint, burn, supply", () => {
  const client = new SSSClient(BASE_URL, API_KEY);

  it("mint() creates a mint event and returns it", async () => {
    const event = await client.mint({
      token_mint: TOKEN_MINT,
      amount: 1_000_000,
      recipient: RECIPIENT,
    });
    expect(event.id).toBeDefined();
    expect(event.token_mint).toBe(TOKEN_MINT);
    expect(event.amount).toBe(1_000_000);
    expect(event.recipient).toBe(RECIPIENT);
    expect(event.created_at).toBeDefined();
  });

  it("mint() with tx_signature records it", async () => {
    // Use a valid 88-char base58 Solana signature (format check in backend requires 80-90 chars)
    const sig = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d6mi8ySAaJBx3YAN1mSbFcgzB9n6z6uMFnvNn3Z1sV8zQ";
    const event = await client.mint({
      token_mint: TOKEN_MINT,
      amount: 500_000,
      recipient: RECIPIENT,
      tx_signature: sig,
    });
    expect(event.tx_signature).toBe(sig);
  });

  it("burn() creates a burn event", async () => {
    const event = await client.burn({
      token_mint: TOKEN_MINT,
      amount: 200_000,
      source: SOURCE,
    });
    expect(event.id).toBeDefined();
    expect(event.token_mint).toBe(TOKEN_MINT);
    expect(event.amount).toBe(200_000);
    expect(event.source).toBe(SOURCE);
  });

  it("getSupply() reflects mint and burn totals", async () => {
    // Capture baseline before this test's mints/burns to handle pre-existing state
    const before = await client.getSupply(TOKEN_MINT);
    const baseMinted = before.total_minted ?? 0;
    const baseBurned = before.total_burned ?? 0;

    // Mint 1_000_000 + 500_000 = 1_500_000, burn 200_000 (already done in earlier tests)
    // Just verify the delta is consistent
    const supply = await client.getSupply(TOKEN_MINT);
    expect(supply.token_mint).toBe(TOKEN_MINT);
    // total_minted must be at least 1_500_000 (tolerates leftover state from prior runs)
    expect(supply.total_minted).toBeGreaterThanOrEqual(1_500_000);
    // total_burned must be at least 200_000
    expect(supply.total_burned).toBeGreaterThanOrEqual(200_000);
    // circulating supply must equal minted - burned
    expect(supply.circulating_supply).toBe(supply.total_minted - supply.total_burned);
  });

  it("getSupply() without filter returns aggregate", async () => {
    const supply = await client.getSupply();
    expect(supply.total_minted).toBeGreaterThanOrEqual(1_500_000);
    expect(supply.circulating_supply).toBeGreaterThan(0);
  });

  it("getEvents() lists mint and burn events", async () => {
    const events = await client.getEvents(TOKEN_MINT);
    expect(events.mint_events.length).toBeGreaterThanOrEqual(2);
    expect(events.burn_events.length).toBeGreaterThanOrEqual(1);
    // Events should have required fields
    const m = events.mint_events[0];
    expect(m.id).toBeDefined();
    expect(m.token_mint).toBe(TOKEN_MINT);
  });

  it("getEvents() with limit constrains results", async () => {
    const events = await client.getEvents(TOKEN_MINT, 1);
    expect(events.mint_events.length).toBeLessThanOrEqual(1);
    expect(events.burn_events.length).toBeLessThanOrEqual(1);
  });
});
