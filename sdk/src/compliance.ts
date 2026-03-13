import { createHash } from "crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Connection, Keypair } from "@solana/web3.js";
import type { BlacklistStatus } from "./types";

const CONFIG_SEED = Buffer.from("config");
const BLACKLIST_SEED = Buffer.from("blacklist");
const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

function anchorDiscriminator(instructionName: string): Buffer {
  return createHash("sha256")
    .update(`global:${instructionName}`)
    .digest()
    .subarray(0, 8);
}

function findConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED, mint.toBuffer()], programId);
}

function findBlacklistPda(wallet: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([BLACKLIST_SEED, wallet.toBuffer()], programId);
}

function findExtraAccountMetasPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()], programId);
}

/**
 * Compliance operations for SSS-2 stablecoins (blacklist transfer hook).
 *
 * This class interacts with the blacklist_hook Anchor program to manage
 * on-chain blacklist entries that block transfers to/from specified wallets.
 */
export class Compliance {
  constructor(
    private readonly connection: Connection,
    private readonly mint: PublicKey,
    private readonly hookProgramId: PublicKey,
  ) {}

  // ---------------------------------------------------------------------------
  // Initialization (called during deploy, exposed for advanced use)
  // ---------------------------------------------------------------------------

  /**
   * Initializes the Config PDA and ExtraAccountMetaList PDA on the
   * blacklist_hook program. Must be called once after the mint is created.
   */
  async initializeHook(admin: Keypair): Promise<{ configPda: PublicKey; extraMetasPda: PublicKey }> {
    const [configPda] = findConfigPda(this.mint, this.hookProgramId);
    const [extraMetasPda] = findExtraAccountMetasPda(this.mint, this.hookProgramId);

    const initConfigIx = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.hookProgramId,
      data: anchorDiscriminator("initialize_config"),
    });
    await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(initConfigIx),
      [admin],
      { commitment: "confirmed" },
    );

    const initMetasIx = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: extraMetasPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.hookProgramId,
      data: anchorDiscriminator("initialize_extra_account_meta_list"),
    });
    await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(initMetasIx),
      [admin],
      { commitment: "confirmed" },
    );

    return { configPda, extraMetasPda };
  }

  // ---------------------------------------------------------------------------
  // Blacklist management
  // ---------------------------------------------------------------------------

  /**
   * Add a wallet to the blacklist. Creates the BlacklistEntry PDA if it
   * doesn't exist, or sets `blocked = true` if it does.
   *
   * @returns Transaction signature.
   */
  async blacklistAdd(wallet: PublicKey, admin: Keypair): Promise<string> {
    const [configPda] = findConfigPda(this.mint, this.hookProgramId);
    const [blacklistPda] = findBlacklistPda(wallet, this.hookProgramId);

    const data = Buffer.concat([
      anchorDiscriminator("add_to_blacklist"),
      wallet.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.hookProgramId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [admin],
      { commitment: "confirmed" },
    );
  }

  /**
   * Remove a wallet from the blacklist. Sets `blocked = false` on the
   * BlacklistEntry PDA (the PDA stays on-chain so the hook can still resolve it).
   *
   * @returns Transaction signature.
   */
  async blacklistRemove(wallet: PublicKey, admin: Keypair): Promise<string> {
    const [configPda] = findConfigPda(this.mint, this.hookProgramId);
    const [blacklistPda] = findBlacklistPda(wallet, this.hookProgramId);

    const data = Buffer.concat([
      anchorDiscriminator("remove_from_blacklist"),
      wallet.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.hookProgramId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [admin],
      { commitment: "confirmed" },
    );
  }

  /**
   * Check whether a wallet is currently blacklisted. Read-only; no
   * transaction is sent.
   */
  async isBlacklisted(wallet: PublicKey): Promise<BlacklistStatus> {
    const [pda] = findBlacklistPda(wallet, this.hookProgramId);
    const accountInfo = await this.connection.getAccountInfo(pda);

    if (!accountInfo || accountInfo.data.length < 8 + 32 + 1) {
      return { wallet, pda, blocked: false };
    }

    // Anchor layout: 8-byte discriminator | 32-byte wallet | 1-byte blocked | 1-byte bump
    const blocked = accountInfo.data[8 + 32] !== 0;
    return { wallet, pda, blocked };
  }

  // ---------------------------------------------------------------------------
  // PDA helpers (useful for building custom transactions)
  // ---------------------------------------------------------------------------

  getConfigPda(): PublicKey {
    return findConfigPda(this.mint, this.hookProgramId)[0];
  }

  getBlacklistPda(wallet: PublicKey): PublicKey {
    return findBlacklistPda(wallet, this.hookProgramId)[0];
  }

  getExtraAccountMetasPda(): PublicKey {
    return findExtraAccountMetasPda(this.mint, this.hookProgramId)[0];
  }
}
