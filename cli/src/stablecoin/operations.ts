import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SolanaStablecoin } from "sss-token-sdk";
import { getConnection, loadKeypair } from "../solana-helpers";
import type { SssConfig } from "../config";

function getProgramId(cfg: SssConfig): PublicKey {
  return cfg.stablecoin.tokenProgram === "spl-token-2022"
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

function requireMint(cfg: SssConfig): PublicKey {
  const m = cfg.stablecoin.mint?.trim();
  if (!m) throw new Error("Config has no mint address. Deploy first with: sss-token init --custom <config>");
  return new PublicKey(m);
}

function loadStablecoin(cfg: SssConfig): SolanaStablecoin {
  const connection = getConnection(cfg);
  const mint = requireMint(cfg);
  const tokenProgramId = getProgramId(cfg);
  const hookCfg = cfg.extensions?.transferHook;
  const transferHookProgramId =
    hookCfg?.enabled && hookCfg.programId?.trim()
      ? new PublicKey(hookCfg.programId)
      : undefined;

  return SolanaStablecoin.load(connection, {
    mint,
    tokenProgramId,
    transferHookProgramId,
  });
}

export async function runMint(
  cfg: SssConfig,
  recipientStr: string,
  amountRaw: bigint,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.mint);
  const recipient = new PublicKey(recipientStr);

  const sig = await stable.mintTokens({
    recipient,
    amount: amountRaw,
    minter: payer,
  });
  console.log("Minted:", amountRaw.toString(), "raw units to", recipientStr);
  console.log("Tx:", sig);
}

export async function runBurn(cfg: SssConfig, amountRaw: bigint): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.mint);

  const sig = await stable.burn({
    amount: amountRaw,
    owner: payer,
  });
  console.log("Burned:", amountRaw.toString(), "raw units");
  console.log("Tx:", sig);
}

export async function runFreeze(cfg: SssConfig, tokenAccountStr: string): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.freeze);
  const tokenAccount = new PublicKey(tokenAccountStr);

  const sig = await stable.freeze({
    tokenAccount,
    freezeAuthority: payer,
  });
  console.log("Froze token account:", tokenAccountStr);
  console.log("Tx:", sig);
}

export async function runThaw(cfg: SssConfig, tokenAccountStr: string): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.freeze);
  const tokenAccount = new PublicKey(tokenAccountStr);

  const sig = await stable.thaw({
    tokenAccount,
    freezeAuthority: payer,
  });
  console.log("Thawed token account:", tokenAccountStr);
  console.log("Tx:", sig);
}

export async function runPause(cfg: SssConfig): Promise<void> {
  if (cfg.stablecoin.tokenProgram !== "spl-token-2022") {
    throw new Error("Pause is only supported for Token-2022 mints with Pausable extension.");
  }
  const pausePath = cfg.authorities.pause;
  if (!pausePath?.trim()) throw new Error("Config has no [authorities] pause keypair path.");

  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(pausePath);

  const sig = await stable.pause(payer);
  console.log("Paused mint:", requireMint(cfg).toBase58());
  console.log("Tx:", sig);
}

export async function runUnpause(cfg: SssConfig): Promise<void> {
  if (cfg.stablecoin.tokenProgram !== "spl-token-2022") {
    throw new Error("Unpause is only supported for Token-2022 mints with Pausable extension.");
  }
  const pausePath = cfg.authorities.pause;
  if (!pausePath?.trim()) throw new Error("Config has no [authorities] pause keypair path.");

  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(pausePath);

  const sig = await stable.unpause(payer);
  console.log("Unpaused mint:", requireMint(cfg).toBase58());
  console.log("Tx:", sig);
}

export async function runStatus(cfg: SssConfig): Promise<void> {
  const stable = loadStablecoin(cfg);
  const status = await stable.getStatus();

  console.log("Standard:", cfg.standard);
  console.log("Cluster:", cfg.cluster);
  console.log("Mint:", status.mint.toBase58());
  console.log("Token program:", cfg.stablecoin.tokenProgram);
  console.log("Authorities (config): mint:", cfg.authorities.mint, "freeze:", cfg.authorities.freeze, "metadata:", cfg.authorities.metadata);
  console.log("Supply (raw):", status.supply.raw.toString());
  console.log("Supply (UI):", status.supply.uiAmountString);
  console.log("Decimals:", status.supply.decimals);
  console.log("Mint authority:", status.mintAuthority?.toBase58() ?? "none");
  console.log("Freeze authority:", status.freezeAuthority?.toBase58() ?? "none");
}

export async function runSupply(cfg: SssConfig): Promise<void> {
  const stable = loadStablecoin(cfg);
  const supply = await stable.getSupply();

  console.log("Supply (raw):", supply.raw.toString());
  console.log("Supply (UI):", supply.uiAmountString);
}

export async function runBalance(cfg: SssConfig, walletStr: string): Promise<void> {
  const stable = loadStablecoin(cfg);
  const wallet = new PublicKey(walletStr);
  const balance = await stable.getBalance(wallet);

  console.log("Token account (ATA):", balance.ata.toBase58());
  console.log("Balance (raw):", balance.raw.toString());
  console.log("Balance (UI):", balance.uiAmountString);
}

export async function runSetAuthority(
  cfg: SssConfig,
  typeStr: string,
  newAuthorityStr: string,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const type = typeStr.toLowerCase();
  const keypairPath = getAuthorityKeypairPath(cfg, type);
  const currentAuthority = loadKeypair(keypairPath);
  const newAuthority =
    newAuthorityStr.toLowerCase() === "none" || newAuthorityStr.trim() === ""
      ? null
      : new PublicKey(newAuthorityStr);

  const sig = await stable.setAuthority({
    type: type as any,
    currentAuthority,
    newAuthority,
  });
  console.log("Authority updated:", type, "->", newAuthority?.toBase58() ?? "none");
  console.log("Tx:", sig);
}

export async function runAuditLog(
  cfg: SssConfig,
  limit: number,
  action?: string,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const entries = await stable.getAuditLog(limit);

  console.log(
    `Last ${entries.length} transactions involving mint ${stable.mint.toBase58()}` +
      (action ? ` (action filter '${action}' is currently informational only)` : ""),
  );
  for (const entry of entries) {
    const when = entry.blockTime ? entry.blockTime.toISOString() : "unknown-time";
    console.log(
      `- sig=${entry.signature} slot=${entry.slot} err=${entry.err ? JSON.stringify(entry.err) : "ok"} time=${when}`,
    );
  }
}

function getAuthorityKeypairPath(cfg: SssConfig, type: string): string {
  const t = type.toLowerCase();
  if (t === "mint") return cfg.authorities.mint;
  if (t === "freeze") return cfg.authorities.freeze;
  if (t === "metadata" || t === "metadata-pointer") return cfg.authorities.metadata;
  if (t === "pause") {
    if (!cfg.authorities.pause?.trim()) throw new Error("Config has no [authorities] pause for type 'pause'.");
    return cfg.authorities.pause;
  }
  if (t === "permanent-delegate") {
    if (!cfg.authorities.permanentDelegate?.trim()) throw new Error("Config has no [authorities] permanentDelegate.");
    return cfg.authorities.permanentDelegate;
  }
  throw new Error(`Unknown authority type: ${type}. Use: mint, freeze, metadata, pause, permanent-delegate`);
}
