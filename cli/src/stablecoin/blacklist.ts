import { PublicKey } from "@solana/web3.js";
import type { Connection, Keypair } from "@solana/web3.js";
import { Compliance, getConfigAddress, getExtraAccountMetasAddress } from "sss-token-sdk";
import { getConnection, loadKeypair } from "../solana-helpers";
import type { SssConfig } from "../config";

function getBlacklistProgramId(cfg: SssConfig): PublicKey {
  const hookCfg = cfg.extensions?.transferHook;
  if (!hookCfg?.enabled || !hookCfg.programId?.trim()) {
    throw new Error(
      "Transfer hook extension is not enabled or programId is not set in config. " +
      "SSS-2 requires [extensions.transferHook] enabled = true and a valid programId.",
    );
  }
  return new PublicKey(hookCfg.programId);
}

function requireBlacklistAuthority(cfg: SssConfig): Keypair {
  const keypairPath = cfg.authorities.blacklist;
  if (!keypairPath?.trim()) {
    throw new Error("Config has no [authorities] blacklist keypair path.");
  }
  return loadKeypair(keypairPath);
}

function requireMint(cfg: SssConfig): PublicKey {
  const m = cfg.stablecoin.mint?.trim();
  if (!m) throw new Error("Config has no mint address. Deploy first with: sss-token init --custom <config>");
  return new PublicKey(m);
}

function loadCompliance(cfg: SssConfig): Compliance {
  const connection = getConnection(cfg);
  const mint = requireMint(cfg);
  const hookProgramId = getBlacklistProgramId(cfg);
  return new Compliance(connection, mint, hookProgramId);
}

/**
 * Called during deployment to initialize the blacklist hook config + extra-account-metas.
 * This is the only function that doesn't go through Compliance.initializeHook
 * because deploy.ts needs the same logic but may also need low-level control.
 */
export async function initializeBlacklistHook(
  connection: Connection,
  blacklistProgramId: PublicKey,
  admin: Keypair,
  mint: PublicKey,
): Promise<void> {
  const compliance = new Compliance(connection, mint, blacklistProgramId);
  const { configPda, extraMetasPda } = await compliance.initializeHook(admin);
  console.log("Initialized blacklist config PDA:", configPda.toBase58());
  console.log("Initialized extra-account-metas PDA:", extraMetasPda.toBase58());
}

export async function runBlacklistAdd(cfg: SssConfig, walletStr: string, reason = ""): Promise<void> {
  const compliance = loadCompliance(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const wallet = new PublicKey(walletStr);

  const sig = await compliance.blacklistAdd(wallet, admin, reason);
  console.log("Added to blacklist:", walletStr);
  if (reason) console.log("Reason:", reason);
  console.log("Blacklist PDA:", compliance.getBlacklistPda(wallet).toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistRemove(cfg: SssConfig, walletStr: string): Promise<void> {
  const compliance = loadCompliance(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const wallet = new PublicKey(walletStr);

  const sig = await compliance.blacklistRemove(wallet, admin);
  console.log("Removed from blacklist:", walletStr);
  console.log("Blacklist PDA:", compliance.getBlacklistPda(wallet).toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistClose(cfg: SssConfig, walletStr: string): Promise<void> {
  const compliance = loadCompliance(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const wallet = new PublicKey(walletStr);

  const sig = await compliance.closeBlacklistEntry(wallet, admin);
  console.log("Closed blacklist entry for:", walletStr);
  console.log("Rent reclaimed to:", admin.publicKey.toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistTransferAdmin(cfg: SssConfig, newAdminStr: string): Promise<void> {
  const compliance = loadCompliance(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const newAdmin = new PublicKey(newAdminStr);

  const sig = await compliance.transferAdmin(newAdmin, admin);
  console.log("Nominated new blacklist admin:", newAdminStr);
  console.log("Pending admin must call 'blacklist accept-admin' to finalize.");
  console.log("Tx:", sig);
}

export async function runBlacklistAcceptAdmin(cfg: SssConfig, newAdminKeypairPath: string): Promise<void> {
  const compliance = loadCompliance(cfg);
  const newAdmin = loadKeypair(newAdminKeypairPath);

  const sig = await compliance.acceptAdmin(newAdmin);
  console.log("Accepted blacklist admin role:", newAdmin.publicKey.toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistCheck(cfg: SssConfig, walletStr: string): Promise<void> {
  const compliance = loadCompliance(cfg);
  const wallet = new PublicKey(walletStr);

  const status = await compliance.isBlacklisted(wallet);
  console.log("Wallet:", walletStr);
  console.log("Blacklist PDA:", status.pda.toBase58());
  console.log("Blacklisted:", status.blocked);
}
