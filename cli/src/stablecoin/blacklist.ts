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

/**
 * Computes the 8-byte Anchor instruction discriminator.
 * Anchor uses sha256("global:<instruction_name>")[0..8].
 */
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

function findBlacklistPda(wallet: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, wallet.toBuffer()],
    programId,
  );
}

function findExtraAccountMetasPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    programId,
  );
}

/**
 * Initializes the blacklist hook Config PDA and ExtraAccountMetaList PDA.
 * Called during SSS-2 deployment after the mint is created.
 */
export async function initializeBlacklistHook(
  connection: Connection,
  blacklistProgramId: PublicKey,
  admin: Keypair,
  mint: PublicKey,
): Promise<void> {
  const [configPda] = findConfigPda(mint, blacklistProgramId);
  const [extraMetasPda] = findExtraAccountMetasPda(mint, blacklistProgramId);

  const initConfigDisc = anchorDiscriminator("initialize_config");
  const initConfigIx = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: blacklistProgramId,
    data: initConfigDisc,
  });

  const tx1 = new Transaction().add(initConfigIx);
  await sendAndConfirmTransaction(connection, tx1, [admin], { commitment: "confirmed" });
  console.log("Initialized blacklist config PDA:", configPda.toBase58());

  const initMetasDisc = anchorDiscriminator("initialize_extra_account_meta_list");
  const initMetasIx = new TransactionInstruction({
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: blacklistProgramId,
    data: initMetasDisc,
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
  const [blacklistPda] = findBlacklistPda(wallet, blacklistProgramId);

  const discriminator = anchorDiscriminator("add_to_blacklist");
  const data = Buffer.concat([discriminator, wallet.toBuffer()]);

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
  const [blacklistPda] = findBlacklistPda(wallet, blacklistProgramId);

  const discriminator = anchorDiscriminator("remove_from_blacklist");
  const data = Buffer.concat([discriminator, wallet.toBuffer()]);

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

export async function runBlacklistCheck(cfg: SssConfig, walletStr: string): Promise<void> {
  const connection = getConnection(cfg);
  const blacklistProgramId = getBlacklistProgramId(cfg);
  const wallet = new PublicKey(walletStr);

  const [blacklistPda] = findBlacklistPda(wallet, blacklistProgramId);

  const accountInfo = await connection.getAccountInfo(blacklistPda);

  console.log("Wallet:", walletStr);
  console.log("Blacklist PDA:", blacklistPda.toBase58());

  if (!accountInfo || accountInfo.data.length === 0) {
    console.log("Blacklisted: false (no entry)");
    return;
  }

  // Anchor account layout: 8-byte discriminator + 32-byte wallet + 1-byte blocked + 1-byte bump
  const data = accountInfo.data;
  if (data.length < 8 + 32 + 1) {
    console.log("Blacklisted: unknown (unexpected account data)");
    return;
  }

  const blocked = data[8 + 32] !== 0;
  console.log("Blacklisted:", blocked);
}
