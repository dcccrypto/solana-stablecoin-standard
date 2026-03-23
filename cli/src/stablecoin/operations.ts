import { PublicKey } from "@solana/web3.js";
import {
  SolanaStablecoin,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getBlacklistAddress,
} from "sss-token-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection, loadKeypair } from "../solana-helpers";
import type { SssConfig } from "../config";
import { printResult, printTx, getOutputFormat } from "../output";

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

function getSsCoreProgramId(cfg: SssConfig): PublicKey | undefined {
  const id = cfg.ssCoreProgramId?.trim();
  return id ? new PublicKey(id) : undefined;
}

function getHookProgramId(cfg: SssConfig): PublicKey | undefined {
  const hookCfg = cfg.extensions?.transferHook;
  return hookCfg?.enabled && hookCfg.programId?.trim()
    ? new PublicKey(hookCfg.programId)
    : undefined;
}

function loadStablecoin(cfg: SssConfig): SolanaStablecoin {
  const connection = getConnection(cfg);
  const mint = requireMint(cfg);
  const tokenProgramId = getProgramId(cfg);
  const transferHookProgramId = getHookProgramId(cfg);
  const ssCoreProgramId = getSsCoreProgramId(cfg);

  return SolanaStablecoin.load(connection, {
    mint,
    tokenProgramId,
    transferHookProgramId,
    ssCoreProgramId,
  });
}

function usesRbac(cfg: SssConfig): boolean {
  return !!getSsCoreProgramId(cfg);
}

export async function runMint(
  cfg: SssConfig,
  recipientStr: string,
  amountRaw: bigint,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.mint);
  const recipient = new PublicKey(recipientStr);

  if (stable.core) {
    const recipientAta = getAssociatedTokenAddressSync(
      stable.mint, recipient, false, stable.tokenProgramId,
    );
    let blEntry: PublicKey | undefined;
    const hookProgramId = getHookProgramId(cfg);
    if (hookProgramId) {
      [blEntry] = getBlacklistAddress(stable.mint, recipient, hookProgramId);
    }
    const sig = await stable.core.mintTokens(payer, recipientAta, amountRaw, blEntry);
    printTx("Minted (RBAC)", { amount: amountRaw.toString(), recipient: recipientStr, tx: sig });
  } else {
    const sig = await stable.mintTokens({
      recipient,
      amount: amountRaw,
      minter: payer,
    });
    printTx("Minted", { amount: amountRaw.toString(), recipient: recipientStr, tx: sig });
  }
}

export async function runTransfer(
  cfg: SssConfig,
  recipientStr: string,
  amountRaw: bigint,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.mint);
  const recipient = new PublicKey(recipientStr);
  const decimals = await stable.getDecimals();

  const sig = await stable.transfer({
    owner: payer,
    destination: recipient,
    amount: amountRaw,
    decimals,
  });
  printTx("Transferred", { amount: amountRaw.toString(), recipient: recipientStr, tx: sig });
}

export async function runBurn(cfg: SssConfig, amountRaw: bigint): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.mint);

  if (stable.core) {
    const burnerAta = getAssociatedTokenAddressSync(
      stable.mint, payer.publicKey, false, stable.tokenProgramId,
    );
    const sig = await stable.core.burnTokens(payer, burnerAta, amountRaw);
    printTx("Burned (RBAC)", { amount: amountRaw.toString(), tx: sig });
  } else {
    const sig = await stable.burn({
      amount: amountRaw,
      owner: payer,
    });
    printTx("Burned", { amount: amountRaw.toString(), tx: sig });
  }
}

export async function runFreeze(cfg: SssConfig, tokenAccountStr: string): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.freeze);
  const tokenAccount = new PublicKey(tokenAccountStr);

  if (stable.core) {
    const sig = await stable.core.freezeAccount(payer, tokenAccount);
    printTx("Froze (RBAC)", { tokenAccount: tokenAccountStr, tx: sig });
  } else {
    const sig = await stable.freeze({
      tokenAccount,
      freezeAuthority: payer,
    });
    printTx("Froze", { tokenAccount: tokenAccountStr, tx: sig });
  }
}

export async function runThaw(cfg: SssConfig, tokenAccountStr: string): Promise<void> {
  const stable = loadStablecoin(cfg);
  const payer = loadKeypair(cfg.authorities.freeze);
  const tokenAccount = new PublicKey(tokenAccountStr);

  if (stable.core) {
    const sig = await stable.core.thawAccount(payer, tokenAccount);
    printTx("Thawed (RBAC)", { tokenAccount: tokenAccountStr, tx: sig });
  } else {
    const sig = await stable.thaw({
      tokenAccount,
      freezeAuthority: payer,
    });
    printTx("Thawed", { tokenAccount: tokenAccountStr, tx: sig });
  }
}

export async function runPause(cfg: SssConfig): Promise<void> {
  const stable = loadStablecoin(cfg);

  if (stable.core) {
    const pausePath = cfg.authorities.pause || cfg.authorities.mint;
    const payer = loadKeypair(pausePath);
    const sig = await stable.core.pause(payer);
    printTx("Paused (RBAC)", { mint: requireMint(cfg).toBase58(), tx: sig });
  } else {
    if (cfg.stablecoin.tokenProgram !== "spl-token-2022") {
      throw new Error("Pause is only supported for Token-2022 mints with Pausable extension.");
    }
    const pausePath = cfg.authorities.pause;
    if (!pausePath?.trim()) throw new Error("Config has no [authorities] pause keypair path.");
    const payer = loadKeypair(pausePath);
    const sig = await stable.pause(payer);
    printTx("Paused", { mint: requireMint(cfg).toBase58(), tx: sig });
  }
}

export async function runUnpause(cfg: SssConfig): Promise<void> {
  const stable = loadStablecoin(cfg);

  if (stable.core) {
    const pausePath = cfg.authorities.pause || cfg.authorities.mint;
    const payer = loadKeypair(pausePath);
    const sig = await stable.core.unpause(payer);
    printTx("Unpaused (RBAC)", { mint: requireMint(cfg).toBase58(), tx: sig });
  } else {
    if (cfg.stablecoin.tokenProgram !== "spl-token-2022") {
      throw new Error("Unpause is only supported for Token-2022 mints with Pausable extension.");
    }
    const pausePath = cfg.authorities.pause;
    if (!pausePath?.trim()) throw new Error("Config has no [authorities] pause keypair path.");
    const payer = loadKeypair(pausePath);
    const sig = await stable.unpause(payer);
    printTx("Unpaused", { mint: requireMint(cfg).toBase58(), tx: sig });
  }
}

export async function runStatus(cfg: SssConfig): Promise<void> {
  const stable = loadStablecoin(cfg);
  const status = await stable.getStatus();

  printResult({
    standard: cfg.standard,
    cluster: cfg.cluster,
    mint: status.mint.toBase58(),
    tokenProgram: cfg.stablecoin.tokenProgram,
    supplyRaw: status.supply.raw.toString(),
    supplyUi: status.supply.uiAmountString,
    decimals: status.supply.decimals,
    mintAuthority: status.mintAuthority?.toBase58() ?? "none",
    freezeAuthority: status.freezeAuthority?.toBase58() ?? "none",
  });
}

export async function runSupply(cfg: SssConfig): Promise<void> {
  const stable = loadStablecoin(cfg);
  const supply = await stable.getSupply();

  printResult({
    raw: supply.raw.toString(),
    ui: supply.uiAmountString,
    decimals: supply.decimals,
  });
}

export async function runBalance(cfg: SssConfig, walletStr: string): Promise<void> {
  const stable = loadStablecoin(cfg);
  const wallet = new PublicKey(walletStr);
  const balance = await stable.getBalance(wallet);

  printResult({
    wallet: walletStr,
    ata: balance.ata.toBase58(),
    raw: balance.raw.toString(),
    ui: balance.uiAmountString,
    exists: balance.exists,
  });
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
  printTx("Authority updated", { type, newAuthority: newAuthority?.toBase58() ?? "none", tx: sig });
}

export async function runAuditLog(
  cfg: SssConfig,
  limit: number,
  action?: string,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const entries = await stable.getAuditLog(limit);

  if (getOutputFormat() === "json") {
    const data = entries.map((e) => ({
      signature: e.signature,
      slot: e.slot,
      err: e.err ?? null,
      blockTime: e.blockTime?.toISOString() ?? null,
    }));
    console.log(JSON.stringify({ mint: stable.mint.toBase58(), entries: data }, null, 2));
    return;
  }

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

export async function runSeize(
  cfg: SssConfig,
  targetTokenAccountStr: string,
  treasuryStr: string,
  amountRaw: bigint,
): Promise<void> {
  const stable = loadStablecoin(cfg);
  const targetTokenAccount = new PublicKey(targetTokenAccountStr);
  const treasury = new PublicKey(treasuryStr);

  if (stable.core) {
    const kpPath = cfg.authorities.permanentDelegate?.trim() || cfg.authorities.freeze || cfg.authorities.mint;
    const seizer = loadKeypair(kpPath);
    const treasuryAta = getAssociatedTokenAddressSync(
      stable.mint, treasury, false, stable.tokenProgramId,
    );
    const sig = await stable.core.seize(seizer, targetTokenAccount, treasuryAta, amountRaw);
    printTx("Seized (RBAC)", { targetTokenAccount: targetTokenAccountStr, treasury: treasuryStr, amount: amountRaw.toString(), tx: sig });
  } else {
    const kpPath = cfg.authorities.permanentDelegate?.trim() || cfg.authorities.freeze || cfg.authorities.mint;
    const authority = loadKeypair(kpPath);
    const sig = await stable.seize({
      authority,
      targetTokenAccount,
      treasury,
      amount: amountRaw,
    });
    printTx("Seized", { targetTokenAccount: targetTokenAccountStr, treasury: treasuryStr, amount: amountRaw.toString(), tx: sig });
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
