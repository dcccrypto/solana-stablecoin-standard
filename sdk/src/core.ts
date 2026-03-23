import { createHash } from "crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Connection, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// ── Seeds ────────────────────────────────────────────────────────────

const SSS_CONFIG_SEED = Buffer.from("sss-config");
const ROLE_SEED = Buffer.from("role");
const MINTER_SEED = Buffer.from("minter");

export const ROLE_MINTER = 0;
export const ROLE_BURNER = 1;
export const ROLE_FREEZER = 2;
export const ROLE_PAUSER = 3;
export const ROLE_BLACKLISTER = 4;
export const ROLE_SEIZER = 5;
export const ROLE_ATTESTOR = 6;

// ── PDA Helpers (standalone, exported) ───────────────────────────────

export function getSssConfigAddress(
  mint: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SSS_CONFIG_SEED, mint.toBuffer()],
    programId,
  );
}

export function getRoleAddress(
  config: PublicKey,
  grantee: PublicKey,
  role: number,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, config.toBuffer(), grantee.toBuffer(), Buffer.from([role])],
    programId,
  );
}

export function getMinterInfoAddress(
  config: PublicKey,
  minter: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_SEED, config.toBuffer(), minter.toBuffer()],
    programId,
  );
}

// ── Anchor discriminator ─────────────────────────────────────────────

function disc(name: string): Buffer {
  return createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function encodeBN(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

// ── Deserialized config state ────────────────────────────────────────

export interface SssConfigState {
  authority: PublicKey;
  pendingAuthority: PublicKey | null;
  mint: PublicKey;
  transferHookProgram: PublicKey | null;
  preset: number;
  paused: boolean;
  complianceEnabled: boolean;
  totalMinted: bigint;
  totalBurned: bigint;
  totalSeized: bigint;
  supplyCap: bigint | null;
  bump: number;
}

export interface MinterInfoState {
  config: PublicKey;
  minter: PublicKey;
  quota: bigint;
  totalMinted: bigint;
  isActive: boolean;
  bump: number;
}

function parseConfigAccount(data: Buffer): SssConfigState {
  let offset = 8; // skip discriminator
  const authority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // Option<Pubkey>: 1 byte tag + 32 bytes if Some
  const hasPending = data[offset] === 1;
  offset += 1;
  const pendingAuthority = hasPending
    ? new PublicKey(data.subarray(offset, offset + 32))
    : null;
  offset += 32;

  const mint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // Option<Pubkey>: 1 byte tag + 32 bytes if Some
  const hasHookProgram = data[offset] === 1;
  offset += 1;
  const transferHookProgram = hasHookProgram
    ? new PublicKey(data.subarray(offset, offset + 32))
    : null;
  offset += 32;

  const preset = data[offset];
  offset += 1;
  const paused = data[offset] !== 0;
  offset += 1;
  const complianceEnabled = data[offset] !== 0;
  offset += 1;

  const totalMinted = data.readBigUInt64LE(offset);
  offset += 8;
  const totalBurned = data.readBigUInt64LE(offset);
  offset += 8;
  const totalSeized = data.readBigUInt64LE(offset);
  offset += 8;

  // Option<u64>: 1 byte tag + 8 bytes if Some
  const hasCap = data[offset] === 1;
  offset += 1;
  const supplyCap = hasCap ? data.readBigUInt64LE(offset) : null;
  offset += 8;

  const bump = data[offset];

  return {
    authority,
    pendingAuthority,
    mint,
    transferHookProgram,
    preset,
    paused,
    complianceEnabled,
    totalMinted,
    totalBurned,
    totalSeized,
    supplyCap,
    bump,
  };
}

function parseMinterInfo(data: Buffer): MinterInfoState {
  let offset = 8;
  const config = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const minter = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const quota = data.readBigUInt64LE(offset);
  offset += 8;
  const totalMinted = data.readBigUInt64LE(offset);
  offset += 8;
  const isActive = data[offset] !== 0;
  offset += 1;
  const bump = data[offset];

  return { config, minter, quota, totalMinted, isActive, bump };
}

// ── Event CPI helpers ─────────────────────────────────────────────────

function getEventAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    programId,
  )[0];
}

// ── SssCoreClient ────────────────────────────────────────────────────

/**
 * Client for the sss-core Anchor program.
 * Provides RBAC-gated minting, burning, freezing, seizing, pause, and
 * authority management — all enforced on-chain via the StablecoinConfig PDA.
 */
export class SssCoreClient {
  readonly configPda: PublicKey;
  private readonly eventAuthority: PublicKey;

  private _state: SssConfigState | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly mint: PublicKey,
    private readonly programId: PublicKey,
    private readonly tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID,
  ) {
    [this.configPda] = getSssConfigAddress(mint, programId);
    this.eventAuthority = getEventAuthorityPda(programId);
  }

  private eventCpiAccounts(): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
    return [
      { pubkey: this.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: this.programId, isSigner: false, isWritable: false },
    ];
  }

  // ── State caching ──────────────────────────────────────────────────

  async refresh(): Promise<void> {
    const info = await this.connection.getAccountInfo(this.configPda);
    if (!info) {
      this._state = null;
      return;
    }
    this._state = parseConfigAccount(info.data);
  }

  getState(): SssConfigState | null {
    return this._state;
  }

  async fetchConfig(): Promise<SssConfigState | null> {
    await this.refresh();
    return this._state;
  }

  async fetchMinterInfo(minter: PublicKey): Promise<MinterInfoState | null> {
    const [pda] = getMinterInfoAddress(this.configPda, minter, this.programId);
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;
    return parseMinterInfo(info.data);
  }

  // ── Initialize ─────────────────────────────────────────────────────

  async initialize(
    authority: Keypair,
    preset: number,
    supplyCap: bigint | null = null,
    complianceEnabled = false,
    transferHookProgram: PublicKey | null = null,
  ): Promise<string> {
    const data = Buffer.concat([
      disc("initialize"),
      Buffer.from([preset]),
      supplyCap !== null
        ? Buffer.concat([Buffer.from([1]), encodeBN(supplyCap)])
        : Buffer.concat([Buffer.from([0]), encodeBN(0n)]),
      Buffer.from([complianceEnabled ? 1 : 0]),
      transferHookProgram !== null
        ? Buffer.concat([Buffer.from([1]), transferHookProgram.toBuffer()])
        : Buffer.from([0]),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: true },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Role management ────────────────────────────────────────────────

  async grantRole(
    authority: Keypair,
    grantee: PublicKey,
    role: number,
  ): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      grantee,
      role,
      this.programId,
    );

    const data = Buffer.concat([disc("grant_role"), Buffer.from([role])]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.configPda, isSigner: false, isWritable: false },
        { pubkey: grantee, isSigner: false, isWritable: false },
        { pubkey: rolePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
  }

  async revokeRole(
    authority: Keypair,
    grantee: PublicKey,
    role: number,
  ): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      grantee,
      role,
      this.programId,
    );

    const data = Buffer.concat([disc("revoke_role"), Buffer.from([role])]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.configPda, isSigner: false, isWritable: false },
        { pubkey: grantee, isSigner: false, isWritable: false },
        { pubkey: rolePda, isSigner: false, isWritable: true },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
  }

  // ── Minter quota ───────────────────────────────────────────────────

  async setMinterQuota(
    authority: Keypair,
    minter: PublicKey,
    quota: bigint,
  ): Promise<string> {
    const [minterInfoPda] = getMinterInfoAddress(
      this.configPda,
      minter,
      this.programId,
    );

    const data = Buffer.concat([disc("set_minter_quota"), encodeBN(quota)]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.configPda, isSigner: false, isWritable: false },
        { pubkey: minter, isSigner: false, isWritable: false },
        { pubkey: minterInfoPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
  }

  // ── Mint (RBAC-gated) ──────────────────────────────────────────────

  async mintTokens(
    minter: Keypair,
    recipientAta: PublicKey,
    amount: bigint,
    recipientBlacklistEntry?: PublicKey,
  ): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      minter.publicKey,
      ROLE_MINTER,
      this.programId,
    );
    const [minterInfoPda] = getMinterInfoAddress(
      this.configPda,
      minter.publicKey,
      this.programId,
    );

    // The on-chain MintTokens context always requires the recipient_blacklist_entry
    // account slot. When compliance is disabled, pass SystemProgram as a placeholder.
    const blEntry = recipientBlacklistEntry ?? SystemProgram.programId;

    const data = Buffer.concat([disc("mint_tokens"), encodeBN(amount)]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: minter.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        { pubkey: minterInfoPda, isSigner: false, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: blEntry, isSigner: false, isWritable: false },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [minter],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Burn (RBAC-gated) ──────────────────────────────────────────────

  async burnTokens(
    burner: Keypair,
    burnerAta: PublicKey,
    amount: bigint,
  ): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      burner.publicKey,
      ROLE_BURNER,
      this.programId,
    );

    const data = Buffer.concat([disc("burn_tokens"), encodeBN(amount)]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: burner.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: true },
        { pubkey: burnerAta, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [burner],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Pause / Unpause ────────────────────────────────────────────────

  async pause(pauser: Keypair): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      pauser.publicKey,
      ROLE_PAUSER,
      this.programId,
    );

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: pauser.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data: disc("pause"),
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [pauser],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  async unpause(pauser: Keypair): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      pauser.publicKey,
      ROLE_PAUSER,
      this.programId,
    );

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: pauser.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data: disc("unpause"),
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [pauser],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Freeze / Thaw ─────────────────────────────────────────────────

  async freezeAccount(freezer: Keypair, targetAta: PublicKey): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      freezer.publicKey,
      ROLE_FREEZER,
      this.programId,
    );

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: freezer.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: false },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: targetAta, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data: disc("freeze_token_account"),
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [freezer],
      { commitment: "confirmed" },
    );
  }

  async thawAccount(freezer: Keypair, targetAta: PublicKey): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      freezer.publicKey,
      ROLE_FREEZER,
      this.programId,
    );

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: freezer.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: false },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: targetAta, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data: disc("thaw_token_account"),
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [freezer],
      { commitment: "confirmed" },
    );
  }

  // ── Seize ──────────────────────────────────────────────────────────

  async seize(
    seizer: Keypair,
    targetAta: PublicKey,
    treasuryAta: PublicKey,
    amount: bigint,
  ): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      seizer.publicKey,
      ROLE_SEIZER,
      this.programId,
    );

    const data = Buffer.concat([disc("seize"), encodeBN(amount)]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: seizer.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: true },
        { pubkey: targetAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [seizer],
      { commitment: "confirmed" },
    );
  }

  // ── Authority transfer ─────────────────────────────────────────────

  async transferAuthority(
    authority: Keypair,
    newAuthority: PublicKey,
  ): Promise<string> {
    const data = Buffer.concat([
      disc("transfer_authority"),
      newAuthority.toBuffer(),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  async acceptAuthority(newAuthority: Keypair): Promise<string> {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: newAuthority.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data: disc("accept_authority"),
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [newAuthority],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Metadata update ────────────────────────────────────────────────

  async updateMetadata(
    authority: Keypair,
    field: "name" | "symbol" | "uri",
    value: string,
  ): Promise<string> {
    const fieldBytes = Buffer.from(field, "utf8");
    const fieldLen = Buffer.alloc(4);
    fieldLen.writeUInt32LE(fieldBytes.length);

    const valueBytes = Buffer.from(value, "utf8");
    const valueLen = Buffer.alloc(4);
    valueLen.writeUInt32LE(valueBytes.length);

    const data = Buffer.concat([
      disc("update_metadata"),
      fieldLen,
      fieldBytes,
      valueLen,
      valueBytes,
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    return sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
  }

  // ── Burn from any account (permanent delegate) ────────────────────

  async burnFrom(
    burner: Keypair,
    targetAta: PublicKey,
    amount: bigint,
  ): Promise<string> {
    const [rolePda] = getRoleAddress(
      this.configPda,
      burner.publicKey,
      ROLE_BURNER,
      this.programId,
    );

    const data = Buffer.concat([disc("burn_from"), encodeBN(amount)]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: burner.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        { pubkey: rolePda, isSigner: false, isWritable: false },
        { pubkey: this.mint, isSigner: false, isWritable: true },
        { pubkey: targetAta, isSigner: false, isWritable: true },
        { pubkey: this.tokenProgramId, isSigner: false, isWritable: false },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [burner],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Compliance toggle ─────────────────────────────────────────────

  async setCompliance(
    authority: Keypair,
    enabled: boolean,
  ): Promise<string> {
    const data = Buffer.concat([
      disc("set_compliance"),
      Buffer.from([enabled ? 1 : 0]),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.configPda, isSigner: false, isWritable: true },
        ...this.eventCpiAccounts(),
      ],
      programId: this.programId,
      data,
    });

    const sig = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(ix),
      [authority],
      { commitment: "confirmed" },
    );
    await this.refresh();
    return sig;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  getRolePda(grantee: PublicKey, role: number): PublicKey {
    return getRoleAddress(this.configPda, grantee, role, this.programId)[0];
  }

  getMinterInfoPda(minter: PublicKey): PublicKey {
    return getMinterInfoAddress(this.configPda, minter, this.programId)[0];
  }
}
