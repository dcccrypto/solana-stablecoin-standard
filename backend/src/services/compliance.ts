import { PublicKey } from "@solana/web3.js";
import type { SolanaContext } from "../solana";
import type pino from "pino";
import type { BlacklistStatus } from "sss-token-sdk";

/**
 * SSS-2 compliance operations — blacklist management.
 * Delegates to the SDK; all state lives on-chain.
 */
export class ComplianceService {
  constructor(
    private ctx: SolanaContext,
    private logger: pino.Logger,
  ) {}

  private requireCompliance() {
    if (!this.ctx.stablecoin.compliance) {
      throw new Error("Compliance operations require SSS-2 with a transfer hook program.");
    }
    if (!this.ctx.blacklistAdmin) {
      throw new Error("No blacklist admin keypair configured.");
    }
    return {
      compliance: this.ctx.stablecoin.compliance,
      admin: this.ctx.blacklistAdmin,
    };
  }

  async blacklistAdd(wallet: string, reason?: string): Promise<{ txSignature: string }> {
    const { compliance, admin } = this.requireCompliance();
    this.logger.info({ wallet, reason }, "Adding wallet to blacklist");

    const sig = await compliance.blacklistAdd(new PublicKey(wallet), admin);

    this.logger.info({ wallet, sig }, "Wallet blacklisted");
    return { txSignature: sig };
  }

  async blacklistRemove(wallet: string, reason?: string): Promise<{ txSignature: string }> {
    const { compliance, admin } = this.requireCompliance();
    this.logger.info({ wallet, reason }, "Removing wallet from blacklist");

    const sig = await compliance.blacklistRemove(new PublicKey(wallet), admin);

    this.logger.info({ wallet, sig }, "Wallet unblacklisted");
    return { txSignature: sig };
  }

  async isBlacklisted(wallet: string): Promise<BlacklistStatus> {
    const { compliance } = this.requireCompliance();
    return compliance.isBlacklisted(new PublicKey(wallet));
  }
}
