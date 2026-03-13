/**
 * QA Integration Tests — SolanaStablecoin (REST wrapper) & SSSClient
 *
 * Tests SolanaStablecoin.create() factory, mint, burn, supply, blacklist,
 * webhook registration, and error handling — all via mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolanaStablecoin } from '../src/stablecoin';
import { SSSClient } from '../src/client';
import { SSSError } from '../src/error';

// ─── fetch mock helpers ───────────────────────────────────────────────────────

function mockFetchOnce(data: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok,
      status,
      json: async () => ({
        success: ok,
        data: ok ? data : null,
        error: ok ? null : String(data),
      }),
    })
  );
}

function mockFetchError(message: string, status = 400) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => ({ success: false, data: null, error: message }),
    })
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

// ─── SolanaStablecoin.create() ────────────────────────────────────────────────

describe('SolanaStablecoin.create()', () => {
  it('returns a SolanaStablecoin instance', () => {
    const sss = SolanaStablecoin.create({
      baseUrl: 'http://localhost:8080',
      apiKey: 'sss_test',
    });
    expect(sss).toBeInstanceOf(SolanaStablecoin);
  });

  it('exposes the underlying SSSClient via .raw', () => {
    const sss = SolanaStablecoin.create({
      baseUrl: 'http://localhost:8080',
      apiKey: 'sss_test',
    });
    expect(sss.raw).toBeInstanceOf(SSSClient);
  });

  it('creates independent instances from distinct configs', () => {
    const a = SolanaStablecoin.create({ baseUrl: 'http://a', apiKey: 'key-a' });
    const b = SolanaStablecoin.create({ baseUrl: 'http://b', apiKey: 'key-b' });
    expect(a.raw).not.toBe(b.raw);
  });
});

// ─── mint ─────────────────────────────────────────────────────────────────────

describe('SolanaStablecoin#mint()', () => {
  it('records a mint event and returns MintEvent', async () => {
    const event = {
      id: 'uuid-mint-1',
      token_mint: 'TokenMintAA',
      amount: 1_000_000,
      recipient: 'RecipAA',
      tx_signature: 'SigAA',
      created_at: '2026-03-13T20:00:00Z',
    };
    mockFetchOnce(event);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    const result = await sss.mint({
      tokenMint: 'TokenMintAA',
      amount: 1_000_000,
      recipient: 'RecipAA',
      txSignature: 'SigAA',
    });

    expect(result.id).toBe('uuid-mint-1');
    expect(result.amount).toBe(1_000_000);
    expect(result.recipient).toBe('RecipAA');
  });

  it('passes camelCase params as snake_case to the API', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { id: 'x', token_mint: 'M', amount: 50, recipient: 'R', tx_signature: null, created_at: '' },
        error: null,
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    await sss.mint({ tokenMint: 'M', amount: 50, recipient: 'R' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty('token_mint', 'M');
    expect(body).toHaveProperty('recipient', 'R');
    expect(body).toHaveProperty('amount', 50);
  });

  it('throws SSSError when mint is rejected (blacklisted recipient)', async () => {
    mockFetchError('Recipient is blacklisted', 400);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    await expect(
      sss.mint({ tokenMint: 'M', amount: 1, recipient: 'blocked' })
    ).rejects.toBeInstanceOf(SSSError);
  });

  it('throws SSSError with 401 when API key is invalid', async () => {
    mockFetchError('Unauthorized', 401);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'bad' });
    let err: SSSError | null = null;
    try {
      await sss.mint({ tokenMint: 'M', amount: 1, recipient: 'R' });
    } catch (e) {
      err = e as SSSError;
    }
    expect(err).toBeInstanceOf(SSSError);
    expect(err?.statusCode).toBe(401);
  });
});

// ─── burn ─────────────────────────────────────────────────────────────────────

describe('SolanaStablecoin#burn()', () => {
  it('records a burn event and returns BurnEvent', async () => {
    const event = {
      id: 'uuid-burn-1',
      token_mint: 'TokenBurnBB',
      amount: 500_000,
      source: 'SourceBB',
      tx_signature: null,
      created_at: '2026-03-13T20:00:00Z',
    };
    mockFetchOnce(event);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    const result = await sss.burn({
      tokenMint: 'TokenBurnBB',
      amount: 500_000,
      source: 'SourceBB',
    });

    expect(result.id).toBe('uuid-burn-1');
    expect(result.amount).toBe(500_000);
    expect(result.source).toBe('SourceBB');
    expect(result.tx_signature).toBeNull();
  });

  it('passes camelCase params as snake_case to the API', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { id: 'y', token_mint: 'M', amount: 99, source: 'S', tx_signature: null, created_at: '' },
        error: null,
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    await sss.burn({ tokenMint: 'M', amount: 99, source: 'S' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty('token_mint', 'M');
    expect(body).toHaveProperty('source', 'S');
    expect(body).toHaveProperty('amount', 99);
  });

  it('throws SSSError on failure', async () => {
    mockFetchError('burn failed', 500);
    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    await expect(
      sss.burn({ tokenMint: 'M', amount: 1, source: 'S' })
    ).rejects.toBeInstanceOf(SSSError);
  });
});

// ─── getSupply ────────────────────────────────────────────────────────────────

describe('SolanaStablecoin#getSupply()', () => {
  it('returns circulating supply for a token mint', async () => {
    const supply = {
      token_mint: 'MintCC',
      total_minted: 1000,
      total_burned: 300,
      circulating_supply: 700,
    };
    mockFetchOnce(supply);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    const result = await sss.getSupply('MintCC');

    expect(result.total_minted).toBe(1000);
    expect(result.total_burned).toBe(300);
    expect(result.circulating_supply).toBe(700);
  });

  it('accepts no token_mint (returns global supply)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { token_mint: '', total_minted: 0, total_burned: 0, circulating_supply: 0 },
        error: null,
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const sss = SolanaStablecoin.create({ baseUrl: 'http://localhost:8080', apiKey: 'k' });
    await sss.getSupply();

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).not.toContain('token_mint=');
  });
});

// ─── SSSClient blacklist ──────────────────────────────────────────────────────

describe('SSSClient blacklist', () => {
  it('addToBlacklist() returns the created entry', async () => {
    const entry = {
      id: 'bl-id-1',
      address: 'BlockedDDDD',
      reason: 'sanctions',
      created_at: '2026-03-13T20:00:00Z',
    };
    mockFetchOnce(entry);

    const client = new SSSClient('http://localhost:8080', 'k');
    const result = await client.addToBlacklist({ address: 'BlockedDDDD', reason: 'sanctions' });

    expect(result.id).toBe('bl-id-1');
    expect(result.address).toBe('BlockedDDDD');
  });

  it('getBlacklist() returns array of entries', async () => {
    const entries = [
      { id: 'bl-1', address: 'Addr1', reason: 'test', created_at: '' },
      { id: 'bl-2', address: 'Addr2', reason: 'test2', created_at: '' },
    ];
    mockFetchOnce(entries);

    const client = new SSSClient('http://localhost:8080', 'k');
    const result = await client.getBlacklist();

    expect(result).toHaveLength(2);
    expect(result[0].address).toBe('Addr1');
  });

  it('removeFromBlacklist() returns { removed: true }', async () => {
    mockFetchOnce({ removed: true, id: 'bl-1' });

    const client = new SSSClient('http://localhost:8080', 'k');
    const result = await client.removeFromBlacklist('bl-1');

    expect(result.removed).toBe(true);
    expect(result.id).toBe('bl-1');
  });
});

// ─── SSSClient webhooks ───────────────────────────────────────────────────────

describe('SSSClient webhooks', () => {
  it('addWebhook() registers a webhook and returns the entry', async () => {
    const entry = {
      id: 'wh-id-1',
      url: 'https://example.com/hook',
      events: ['mint', 'burn'],
      created_at: '2026-03-13T20:00:00Z',
    };
    mockFetchOnce(entry);

    const client = new SSSClient('http://localhost:8080', 'k');
    const result = await client.addWebhook({
      url: 'https://example.com/hook',
      events: ['mint', 'burn'],
    });

    expect(result.id).toBe('wh-id-1');
    expect(result.events).toContain('mint');
    expect(result.events).toContain('burn');
  });

  it('getWebhooks() returns list of registered webhooks', async () => {
    const webhooks = [
      { id: 'wh-1', url: 'https://a.com/hook', events: ['mint'], created_at: '' },
    ];
    mockFetchOnce(webhooks);

    const client = new SSSClient('http://localhost:8080', 'k');
    const result = await client.getWebhooks();

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://a.com/hook');
  });

  it('deleteWebhook() returns { deleted: true }', async () => {
    mockFetchOnce({ deleted: true, id: 'wh-1' });

    const client = new SSSClient('http://localhost:8080', 'k');
    const result = await client.deleteWebhook('wh-1');

    expect(result.deleted).toBe(true);
  });
});

// ─── SSSError ─────────────────────────────────────────────────────────────────

describe('SSSError', () => {
  it('has message and statusCode', () => {
    const err = new SSSError('Rate limit exceeded', 429);
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.statusCode).toBe(429);
    expect(err).toBeInstanceOf(Error);
  });
});
