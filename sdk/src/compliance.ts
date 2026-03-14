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

// ─── Exported PDA helpers (standalone, like vault standard) ──────────────────

export function getConfigAddress(
  mint: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    programId,
  );
}

export function getBlacklistAddress(
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, mint.toBuffer(), wallet.toBuffer()],
    programId,
  );
}

export function getExtraAccountMetasAddress(
  mint: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    programId,
  );
}

/**
 * Compliance operations for SSS-2 stablecoins (blacklist transfer hook).
 *
 * Interacts with the blacklist_hook Anchor program to manage on-chain
 * blacklist entries that block transfers to/from specified wallets.
 */
export class Compliance {
  constructor(
    private readonly connection: Connection,
    private readonly mint: PublicKey,
    private readonly hookProgramId: PublicKey,
  ) {}

  // ─── Initialization (called during deploy) ─────────────────────────────────

  async initializeHook(
    admin: Keypair,
  ): Promise<{ configPda: PublicKey; extraMetasPda: PublicKey }> {
    const [configPda] = getConfigAddress(this.mint, this.hookProgramId);
    const [extraMetasPda] = getExtraAccountMetasAddress(
      this.mint,
      this.hookProgramId,
    );

    const initConfigIx = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
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
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
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

  // ─── Blacklist management ──────────────────────────────────────────────────

  async blacklistAdd(wallet: PublicKey, admin: Keypair, reason = ""): Promise<string> {
    const [configPda] = getConfigAddress(this.mint, this.hookProgramId);
    const [blacklistPda] = getBlacklistAddress(
      this.mint,
      wallet,
      this.hookProgramId,
    );

    const reasonBytes = Buffer.from(reason, "utf8");
    const reasonLen = Buffer.alloc(4);
    reasonLen.writeUInt32LE(reasonBytes.length);

    const data = Buffer.concat([
      anchorDiscriminator("add_to_blacklist"),
      wallet.toBuffer(),
      reasonLen,
      reasonBytes,
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
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

  async blacklistRemove(wallet: PublicKey, admin: Keypair): Promise<string> {
    const [configPda] = getConfigAddress(this.mint, this.hookProgramId);
    const [blacklistPda] = getBlacklistAddress(
      this.mint,
      wallet,
      this.hookProgramId,
    );

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
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
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
   * Close an unblocked blacklist entry PDA to reclaim rent.
   * Fails if the entry is still blocked.
   */
  async closeBlacklistEntry(
    wallet: PublicKey,
    admin: Keypair,
  ): Promise<string> {
    const [configPda] = getConfigAddress(this.mint, this.hookProgramId);
    const [blacklistPda] = getBlacklistAddress(
      this.mint,
      wallet,
      this.hookProgramId,
    );

    const data = Buffer.concat([
      anchorDiscriminator("close_blacklist_entry"),
      wallet.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
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

  // ─── Two-step admin transfer ───────────────────────────────────────────────

  async transferAdmin(
    newAdmin: PublicKey,
    currentAdmin: Keypair,
  ): Promise<string> {
    const [configPda] = getConfigAddress(this.mint, this.hookProgramId);

    const data = Buffer.concat([
      anchorDiscriminator("transfer_admin"),
      newAdmin.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        {
          pubkey: currentAdmin.publicKey,
          isSigner: true,
          isWritable: true,
        },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
      ],
      programId: this.hookProgramId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [currentAdmin],
      { commitment: "confirmed" },
    );
  }

  async acceptAdmin(newAdmin: Keypair): Promise<string> {
    const [configPda] = getConfigAddress(this.mint, this.hookProgramId);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: newAdmin.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
      ],
      programId: this.hookProgramId,
      data: anchorDiscriminator("accept_admin"),
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [newAdmin],
      { commitment: "confirmed" },
    );
  }

  // ─── Read-only queries ─────────────────────────────────────────────────────

  async isBlacklisted(wallet: PublicKey): Promise<BlacklistStatus> {
    const [pda] = getBlacklistAddress(this.mint, wallet, this.hookProgramId);
    const accountInfo = await this.connection.getAccountInfo(pda);

    if (!accountInfo || accountInfo.data.length < 8 + 32 + 32 + 1) {
      return { wallet, pda, blocked: false };
    }

    // Layout: 8-byte disc | 32-byte wallet | 32-byte mint | 1-byte blocked | 4+N reason | ...
    const blocked = accountInfo.data[8 + 32 + 32] !== 0;
    let reason: string | undefined;
    if (blocked) {
      const reasonOffset = 8 + 32 + 32 + 1;
      const reasonLen = accountInfo.data.readUInt32LE(reasonOffset);
      if (reasonLen > 0 && reasonLen <= 128) {
        reason = accountInfo.data
          .subarray(reasonOffset + 4, reasonOffset + 4 + reasonLen)
          .toString("utf8");
      }
    }
    return { wallet, pda, blocked, reason };
  }

  // ─── PDA helpers ───────────────────────────────────────────────────────────

  getConfigPda(): PublicKey {
    return getConfigAddress(this.mint, this.hookProgramId)[0];
  }

  getBlacklistPda(wallet: PublicKey): PublicKey {
    return getBlacklistAddress(this.mint, wallet, this.hookProgramId)[0];
  }

  getExtraAccountMetasPda(): PublicKey {
    return getExtraAccountMetasAddress(this.mint, this.hookProgramId)[0];
  }
}
