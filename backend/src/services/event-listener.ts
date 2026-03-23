import type { SolanaContext } from "../solana";
import type { WebhookService } from "./webhook";
import type pino from "pino";

/**
 * Polls the chain for new transactions involving the mint and dispatches
 * events to registered webhooks. In production, consider replacing polling
 * with Solana's `onLogs` WebSocket subscription for lower latency.
 */
export class EventListener {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastSignature: string | null = null;

  constructor(
    private ctx: SolanaContext,
    private webhookService: WebhookService,
    private logger: pino.Logger,
    private pollIntervalMs: number,
  ) {}

  start(): void {
    if (this.intervalId) return;
    this.logger.info(
      { intervalMs: this.pollIntervalMs, mint: this.ctx.stablecoin.mint.toBase58() },
      "Event listener started",
    );
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
    this.poll();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info("Event listener stopped");
    }
  }

  private async poll(): Promise<void> {
    try {
      const opts: { limit: number; until?: string } = { limit: 25 };
      if (this.lastSignature) opts.until = this.lastSignature;

      const sigs = await this.ctx.connection.getSignaturesForAddress(
        this.ctx.stablecoin.mint,
        opts,
      );

      if (sigs.length === 0) return;

      this.lastSignature = sigs[0].signature;

      for (const sig of sigs) {
        const event = sig.err ? "transaction.failed" : "transaction.confirmed";

        await this.webhookService.dispatch(event, {
          signature: sig.signature,
          slot: sig.slot,
          err: sig.err,
          blockTime: sig.blockTime,
          mint: this.ctx.stablecoin.mint.toBase58(),
        });
      }

      this.logger.debug({ count: sigs.length }, "Processed new transactions");
    } catch (err) {
      this.logger.error({ err }, "Event listener poll error");
    }
  }
}
