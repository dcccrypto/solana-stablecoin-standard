import { createHash } from "crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Connection, Keypair } from "@solana/web3.js";
import { getConnection, loadKeypair } from "../solana-helpers";
import type { SssConfig } from "../config";

const CONFIG_SEED = Buffer.from("config");
const BLACKLIST_SEED = Buffer.from("blacklist");
const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

function anchorDiscriminator(instructionName: string): Buffer {
  return createHash("sha256")
    .update(`global:${instructionName}`)
    .digest()
    .subarray(0, 8);
}

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

function findConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    programId,
  );
}

function findBlacklistPda(mint: PublicKey, wallet: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, mint.toBuffer(), wallet.toBuffer()],
    programId,
  );
}

function findExtraAccountMetasPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    programId,
  );
}

export async function initializeBlacklistHook(
  connection: Connection,
  blacklistProgramId: PublicKey,
  admin: Keypair,
  mint: PublicKey,
): Promise<void> {
  const [configPda] = findConfigPda(mint, blacklistProgramId);
  const [extraMetasPda] = findExtraAccountMetasPda(mint, blacklistProgramId);

  const initConfigIx = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: blacklistProgramId,
    data: anchorDiscriminator("initialize_config"),
  });

  const tx1 = new Transaction().add(initConfigIx);
  await sendAndConfirmTransaction(connection, tx1, [admin], { commitment: "confirmed" });
  console.log("Initialized blacklist config PDA:", configPda.toBase58());

  const initMetasIx = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: blacklistProgramId,
    data: anchorDiscriminator("initialize_extra_account_meta_list"),
  });

  const tx2 = new Transaction().add(initMetasIx);
  await sendAndConfirmTransaction(connection, tx2, [admin], { commitment: "confirmed" });
  console.log("Initialized extra-account-metas PDA:", extraMetasPda.toBase58());
}

export async function runBlacklistAdd(cfg: SssConfig, walletStr: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const mint = requireMint(cfg);
  const wallet = new PublicKey(walletStr);

  const [configPda] = findConfigPda(mint, blacklistProgramId);
  const [blacklistPda] = findBlacklistPda(mint, wallet, blacklistProgramId);

  const data = Buffer.concat([
    anchorDiscriminator("add_to_blacklist"),
    wallet.toBuffer(),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: blacklistPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: blacklistProgramId,
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Added to blacklist:", walletStr);
  console.log("Blacklist PDA:", blacklistPda.toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistRemove(cfg: SssConfig, walletStr: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const mint = requireMint(cfg);
  const wallet = new PublicKey(walletStr);

  const [configPda] = findConfigPda(mint, blacklistProgramId);
  const [blacklistPda] = findBlacklistPda(mint, wallet, blacklistProgramId);

  const data = Buffer.concat([
    anchorDiscriminator("remove_from_blacklist"),
    wallet.toBuffer(),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: blacklistPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: blacklistProgramId,
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Removed from blacklist:", walletStr);
  console.log("Blacklist PDA:", blacklistPda.toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistClose(cfg: SssConfig, walletStr: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const mint = requireMint(cfg);
  const wallet = new PublicKey(walletStr);

  const [configPda] = findConfigPda(mint, blacklistProgramId);
  const [blacklistPda] = findBlacklistPda(mint, wallet, blacklistProgramId);

  const data = Buffer.concat([
    anchorDiscriminator("close_blacklist_entry"),
    wallet.toBuffer(),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: blacklistPda, isSigner: false, isWritable: true },
    ],
    programId: blacklistProgramId,
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Closed blacklist entry for:", walletStr);
  console.log("Rent reclaimed to:", admin.publicKey.toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistTransferAdmin(cfg: SssConfig, newAdminStr: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const admin = requireBlacklistAuthority(cfg);
  const mint = requireMint(cfg);
  const newAdmin = new PublicKey(newAdminStr);

  const [configPda] = findConfigPda(mint, blacklistProgramId);

  const data = Buffer.concat([
    anchorDiscriminator("transfer_admin"),
    newAdmin.toBuffer(),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
    ],
    programId: blacklistProgramId,
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Nominated new blacklist admin:", newAdminStr);
  console.log("Pending admin must call 'blacklist accept-admin' to finalize.");
  console.log("Tx:", sig);
}

export async function runBlacklistAcceptAdmin(cfg: SssConfig, newAdminKeypairPath: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const mint = requireMint(cfg);
  const newAdmin = loadKeypair(newAdminKeypairPath);

  const [configPda] = findConfigPda(mint, blacklistProgramId);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: newAdmin.publicKey, isSigner: true, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
    ],
    programId: blacklistProgramId,
    data: anchorDiscriminator("accept_admin"),
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [newAdmin], { commitment: "confirmed" });
  console.log("Accepted blacklist admin role:", newAdmin.publicKey.toBase58());
  console.log("Tx:", sig);
}

export async function runBlacklistCheck(cfg: SssConfig, walletStr: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const mint = requireMint(cfg);
  const wallet = new PublicKey(walletStr);

  const [blacklistPda] = findBlacklistPda(mint, wallet, blacklistProgramId);

  const accountInfo = await connection.getAccountInfo(blacklistPda);

  console.log("Wallet:", walletStr);
  console.log("Blacklist PDA:", blacklistPda.toBase58());

  if (!accountInfo || accountInfo.data.length === 0) {
    console.log("Blacklisted: false (no entry)");
    return;
  }

  // Layout: 8-byte discriminator | 32-byte wallet | 32-byte mint | 1-byte blocked | 1-byte bump
  const data = accountInfo.data;
  if (data.length < 8 + 32 + 32 + 1) {
    console.log("Blacklisted: unknown (unexpected account data)");
    return;
  }

  const blocked = data[8 + 32 + 32] !== 0;
  console.log("Blacklisted:", blocked);
}
