#!/usr/bin/env node
import { Command } from "commander";
import { SSSClient, SSSError } from "@stbr/sss-token";

const program = new Command();

program
  .name("sss-token")
  .description("CLI for the Solana Stablecoin Standard (SSS) backend")
  .version("0.1.0")
  .option("-u, --url <url>", "Backend base URL", "http://localhost:8080")
  .option(
    "-k, --key <apiKey>",
    "API key (or set SSS_API_KEY env var)",
    process.env["SSS_API_KEY"] ?? ""
  );

// ─── Helper ──────────────────────────────────────────────────────────────────

function getClient(opts: { url: string; key: string }): SSSClient {
  if (!opts.key) {
    console.error("Error: API key required. Use --key or set SSS_API_KEY.");
    process.exit(1);
  }
  return new SSSClient(opts.url, opts.key);
}

function print(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

async function run(fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    print(result);
  } catch (err) {
    if (err instanceof SSSError) {
      console.error(`Error (${err.statusCode ?? "unknown"}): ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error("Unknown error:", err);
    }
    process.exit(1);
  }
}

// ─── health ──────────────────────────────────────────────────────────────────

program
  .command("health")
  .description("Check backend health")
  .action(async () => {
    const opts = program.opts<{ url: string; key: string }>();
    // health is public, but still pass through client for URL convenience
    const client = new SSSClient(opts.url, opts.key || "none");
    await run(() => client.health());
  });

// ─── mint ────────────────────────────────────────────────────────────────────

program
  .command("mint")
  .description("Record a stablecoin mint event")
  .requiredOption("--token-mint <addr>", "Token mint public key")
  .requiredOption("--amount <n>", "Amount (raw units)", parseInt)
  .requiredOption("--recipient <addr>", "Recipient wallet public key")
  .option("--tx-sig <sig>", "Transaction signature")
  .action(async (cmdOpts: { tokenMint: string; amount: number; recipient: string; txSig?: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() =>
      client.mint({
        token_mint: cmdOpts.tokenMint,
        amount: cmdOpts.amount,
        recipient: cmdOpts.recipient,
        tx_signature: cmdOpts.txSig,
      })
    );
  });

// ─── burn ────────────────────────────────────────────────────────────────────

program
  .command("burn")
  .description("Record a stablecoin burn event")
  .requiredOption("--token-mint <addr>", "Token mint public key")
  .requiredOption("--amount <n>", "Amount (raw units)", parseInt)
  .requiredOption("--source <addr>", "Source wallet public key")
  .option("--tx-sig <sig>", "Transaction signature")
  .action(async (cmdOpts: { tokenMint: string; amount: number; source: string; txSig?: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() =>
      client.burn({
        token_mint: cmdOpts.tokenMint,
        amount: cmdOpts.amount,
        source: cmdOpts.source,
        tx_signature: cmdOpts.txSig,
      })
    );
  });

// ─── supply ──────────────────────────────────────────────────────────────────

program
  .command("supply")
  .description("Query circulating supply")
  .option("--token-mint <addr>", "Filter by token mint")
  .action(async (cmdOpts: { tokenMint?: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.getSupply(cmdOpts.tokenMint));
  });

// ─── events ──────────────────────────────────────────────────────────────────

program
  .command("events")
  .description("List mint/burn events")
  .option("--token-mint <addr>", "Filter by token mint")
  .option("--limit <n>", "Max events to return", parseInt)
  .action(async (cmdOpts: { tokenMint?: string; limit?: number }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.getEvents(cmdOpts.tokenMint, cmdOpts.limit));
  });

// ─── blacklist ───────────────────────────────────────────────────────────────

const blacklist = program.command("blacklist").description("Manage blacklist");

blacklist
  .command("list")
  .description("List blacklisted addresses")
  .action(async () => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.getBlacklist());
  });

blacklist
  .command("add")
  .description("Add an address to the blacklist")
  .requiredOption("--address <addr>", "Wallet address to blacklist")
  .requiredOption("--reason <text>", "Reason for blacklisting")
  .action(async (cmdOpts: { address: string; reason: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() =>
      client.addToBlacklist({ address: cmdOpts.address, reason: cmdOpts.reason })
    );
  });

blacklist
  .command("remove")
  .description("Remove an address from the blacklist")
  .requiredOption("--id <id>", "Blacklist entry ID")
  .action(async (cmdOpts: { id: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.removeFromBlacklist(cmdOpts.id));
  });

// ─── audit ────────────────────────────────────────────────────────────────────

program
  .command("audit")
  .description("View the compliance audit log")
  .action(async () => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.getAuditLog());
  });

// ─── webhook ──────────────────────────────────────────────────────────────────

const webhook = program.command("webhook").description("Manage webhooks");

webhook
  .command("list")
  .description("List registered webhooks")
  .action(async () => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.getWebhooks());
  });

webhook
  .command("add")
  .description("Register a webhook")
  .requiredOption("--url <url>", "Webhook URL (HTTPS)")
  .requiredOption("--events <kinds>", "Comma-separated event kinds: mint,burn,all")
  .action(async (cmdOpts: { url: string; events: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    const events = cmdOpts.events.split(",").map((e) => e.trim()) as Array<"mint" | "burn" | "all">;
    await run(() => client.addWebhook({ url: cmdOpts.url, events }));
  });

webhook
  .command("delete")
  .description("Delete a webhook")
  .requiredOption("--id <id>", "Webhook ID")
  .action(async (cmdOpts: { id: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.deleteWebhook(cmdOpts.id));
  });

// ─── key ──────────────────────────────────────────────────────────────────────

const key = program.command("key").description("Manage API keys");

key
  .command("list")
  .description("List API keys (values redacted)")
  .action(async () => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.listApiKeys());
  });

key
  .command("create")
  .description("Create a new API key")
  .option("--label <text>", "Human-readable label")
  .action(async (cmdOpts: { label?: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.createApiKey(cmdOpts.label));
  });

key
  .command("delete")
  .description("Delete an API key")
  .requiredOption("--id <id>", "API key ID")
  .action(async (cmdOpts: { id: string }) => {
    const opts = program.opts<{ url: string; key: string }>();
    const client = getClient(opts);
    await run(() => client.deleteApiKey(cmdOpts.id));
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
