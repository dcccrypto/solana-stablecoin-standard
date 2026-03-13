/**
 * SolanaStablecoin — high-level wrapper around SSSClient.
 *
 * Provides a `SolanaStablecoin.create()` factory that returns a fully
 * configured client instance, plus convenience aliases for common operations.
 */
import { SSSClient } from "./client.js";
import type { MintEvent, BurnEvent, SupplyResponse } from "./types.js";

export interface SolanaStablecoinConfig {
  /** Base URL of the SSS backend, e.g. "http://localhost:8080" */
  baseUrl: string;
  /** API key (X-Api-Key) */
  apiKey: string;
}

export class SolanaStablecoin {
  private readonly client: SSSClient;

  private constructor(config: SolanaStablecoinConfig) {
    this.client = new SSSClient(config.baseUrl, config.apiKey);
  }

  /**
   * Factory method — creates a connected SolanaStablecoin instance.
   *
   * ```ts
   * const sss = SolanaStablecoin.create({ baseUrl: "http://localhost:8080", apiKey: "sss_..." });
   * ```
   */
  static create(config: SolanaStablecoinConfig): SolanaStablecoin {
    return new SolanaStablecoin(config);
  }

  /** Record a mint event. */
  async mint(params: {
    tokenMint: string;
    amount: number;
    recipient: string;
    txSignature?: string;
  }): Promise<MintEvent> {
    return this.client.mint({
      token_mint: params.tokenMint,
      amount: params.amount,
      recipient: params.recipient,
      tx_signature: params.txSignature,
    });
  }

  /** Record a burn event. */
  async burn(params: {
    tokenMint: string;
    amount: number;
    source: string;
    txSignature?: string;
  }): Promise<BurnEvent> {
    return this.client.burn({
      token_mint: params.tokenMint,
      amount: params.amount,
      source: params.source,
      tx_signature: params.txSignature,
    });
  }

  /** Get circulating supply for a token mint. */
  async getSupply(tokenMint?: string): Promise<SupplyResponse> {
    return this.client.getSupply(tokenMint);
  }

  /** Expose the underlying SSSClient for advanced usage. */
  get raw(): SSSClient {
    return this.client;
  }
}
