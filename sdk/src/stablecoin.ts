/**
 * SolanaStablecoin — high-level wrapper around SSSClient.
 *
 * Provides a `SolanaStablecoin.create()` factory that returns a fully
 * configured client instance, plus convenience aliases for common operations.
 */
import { SSSClient } from "./client.js";
import type { MintEvent, BurnEvent, SupplyResponse } from "./api-types.js";

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

  /**
   * Record an **off-chain** mint event in the SSS backend database.
   *
   * @remarks
   * **This method does NOT perform any on-chain Solana transaction.**
   * It only POSTs an event record to the SSS backend API (`/api/mint`).
   * To actually mint tokens on-chain, you must submit a Solana transaction
   * via the SSS program separately (e.g. using `SolanaStablecoin.mintTo()`
   * from the Anchor client wrapper).
   *
   * @param params.txSignature - The Solana transaction signature confirming
   * the on-chain mint. Must be a valid base58-encoded 88-character signature.
   * **Required:** the backend will reject requests without a confirmed
   * on-chain transaction signature.
   *
   * @throws {SSSError} if `params.amount` is not a positive number.
   * @throws {SSSError} if `params.txSignature` is missing or blank.
   */
  async mint(params: {
    tokenMint: string;
    amount: number;
    recipient: string;
    txSignature: string;
  }): Promise<MintEvent> {
    if (params.amount <= 0) {
      throw new Error(
        `SSSError: mint amount must be > 0, got ${params.amount}`
      );
    }
    if (!params.txSignature || params.txSignature.trim() === "") {
      throw new Error(
        "SSSError: txSignature is required for mint — provide the confirmed Solana transaction signature"
      );
    }
    return this.client.mint({
      token_mint: params.tokenMint,
      amount: params.amount,
      recipient: params.recipient,
      tx_signature: params.txSignature,
    });
  }

  /**
   * Record an **off-chain** burn event in the SSS backend database.
   *
   * @remarks
   * **This method does NOT perform any on-chain Solana transaction.**
   * It only POSTs an event record to the SSS backend API (`/api/burn`).
   * To actually burn tokens on-chain, you must submit a Solana transaction
   * via the SSS program separately (e.g. using `SolanaStablecoin.burnFrom()`
   * from the Anchor client wrapper).
   *
   * @param params.txSignature - The Solana transaction signature confirming
   * the on-chain burn. Must be a valid base58-encoded 88-character signature.
   * **Required:** the backend will reject requests without a confirmed
   * on-chain transaction signature.
   *
   * @throws {SSSError} if `params.amount` is not a positive number.
   * @throws {SSSError} if `params.txSignature` is missing or blank.
   */
  async burn(params: {
    tokenMint: string;
    amount: number;
    source: string;
    txSignature: string;
  }): Promise<BurnEvent> {
    if (params.amount <= 0) {
      throw new Error(
        `SSSError: burn amount must be > 0, got ${params.amount}`
      );
    }
    if (!params.txSignature || params.txSignature.trim() === "") {
      throw new Error(
        "SSSError: txSignature is required for burn — provide the confirmed Solana transaction signature"
      );
    }
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
