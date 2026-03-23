import { PublicKey } from "@solana/web3.js";
import type { SolanaContext } from "../solana";
import type pino from "pino";

/**
 * Thin orchestration layer around the SDK for mint/burn operations.
 * All state lives on-chain — this service adds logging and validation.
 */
export class MintBurnService {
  constructor(
    private ctx: SolanaContext,
    private logger: pino.Logger,
  ) {}

  async mint(recipient: string, amount: string): Promise<{ txSignature: string }> {
    this.logger.info({ recipient, amount }, "Minting tokens");

    const sig = await this.ctx.stablecoin.mintTokens({
      recipient: new PublicKey(recipient),
      amount: BigInt(amount),
      minter: this.ctx.authority,
    });

    this.logger.info({ sig }, "Mint completed");
    return { txSignature: sig };
  }

  async burn(amount: string): Promise<{ txSignature: string }> {
    this.logger.info({ amount }, "Burning tokens");

    const sig = await this.ctx.stablecoin.burn({
      amount: BigInt(amount),
      owner: this.ctx.authority,
    });

    this.logger.info({ sig }, "Burn completed");
    return { txSignature: sig };
  }
}
