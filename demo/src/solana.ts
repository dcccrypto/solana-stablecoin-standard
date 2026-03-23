import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createBurnInstruction,
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  createSetAuthorityInstruction,
  getMint,
  getAccount,
  AuthorityType,
} from "@solana/spl-token";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function tokenProgramId(program: string): PublicKey {
  return program === "spl-token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

async function anchorDiscriminator(name: string): Promise<Buffer> {
  const data = new TextEncoder().encode(`global:${name}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(new Uint8Array(hash).slice(0, 8));
}

function formatUiAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const str = raw.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals);
  const fracPart = str.slice(str.length - decimals);
  return `${intPart}.${fracPart}`;
}

// ─── Token operations (build Transaction, caller signs via Phantom) ──────────

export async function buildMintTx(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  amount: bigint,
  programId: PublicKey,
): Promise<Transaction> {
  const ata = getAssociatedTokenAddressSync(mint, recipient, false, programId);
  const tx = new Transaction();

  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer,
        ata,
        recipient,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.add(createMintToInstruction(mint, ata, payer, amount, [], programId));
  return tx;
}

export function buildBurnTx(
  payer: PublicKey,
  mint: PublicKey,
  amount: bigint,
  programId: PublicKey,
  tokenAccount?: PublicKey,
): Transaction {
  const ata = tokenAccount ?? getAssociatedTokenAddressSync(mint, payer, false, programId);
  return new Transaction().add(
    createBurnInstruction(ata, mint, payer, amount, [], programId),
  );
}

export function buildFreezeTx(
  mint: PublicKey,
  tokenAccount: PublicKey,
  authority: PublicKey,
  programId: PublicKey,
): Transaction {
  return new Transaction().add(
    createFreezeAccountInstruction(tokenAccount, mint, authority, [], programId),
  );
}

export function buildThawTx(
  mint: PublicKey,
  tokenAccount: PublicKey,
  authority: PublicKey,
  programId: PublicKey,
): Transaction {
  return new Transaction().add(
    createThawAccountInstruction(tokenAccount, mint, authority, [], programId),
  );
}

const AUTHORITY_TYPE_MAP: Record<string, AuthorityType> = {
  mint: AuthorityType.MintTokens,
  freeze: AuthorityType.FreezeAccount,
  metadata: AuthorityType.MetadataPointer,
  "metadata-pointer": AuthorityType.MetadataPointer,
  pause: AuthorityType.PausableConfig,
  "permanent-delegate": AuthorityType.PermanentDelegate,
  "close-mint": AuthorityType.CloseMint,
  "interest-rate": AuthorityType.InterestRate,
};

export function buildSetAuthorityTx(
  mint: PublicKey,
  currentAuthority: PublicKey,
  type: string,
  newAuthority: PublicKey | null,
  programId: PublicKey,
): Transaction {
  const authType = AUTHORITY_TYPE_MAP[type];
  if (authType === undefined) {
    throw new Error(`Unknown authority type: ${type}`);
  }
  return new Transaction().add(
    createSetAuthorityInstruction(mint, currentAuthority, authType, newAuthority, [], programId),
  );
}

// ─── Read operations ─────────────────────────────────────────────────────────

export async function fetchSupply(connection: Connection, mint: PublicKey, programId: PublicKey) {
  const info = await getMint(connection, mint, "confirmed", programId);
  return {
    raw: info.supply.toString(),
    uiAmount: Number(info.supply) / Math.pow(10, info.decimals),
    uiAmountString: formatUiAmount(info.supply, info.decimals),
    decimals: info.decimals,
  };
}

export async function fetchBalance(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey,
) {
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, programId);
  try {
    const account = await getAccount(connection, ata, "confirmed", programId);
    const info = await getMint(connection, mint, "confirmed", programId);
    return {
      raw: account.amount.toString(),
      uiAmount: Number(account.amount) / Math.pow(10, info.decimals),
      uiAmountString: formatUiAmount(account.amount, info.decimals),
      ata: ata.toBase58(),
      exists: true,
    };
  } catch {
    return { raw: "0", uiAmount: 0, uiAmountString: "0", ata: ata.toBase58(), exists: false };
  }
}

export async function fetchStatus(connection: Connection, mint: PublicKey, programId: PublicKey) {
  const info = await getMint(connection, mint, "confirmed", programId);
  return {
    mint: mint.toBase58(),
    supply: {
      raw: info.supply.toString(),
      uiAmount: Number(info.supply) / Math.pow(10, info.decimals),
      uiAmountString: formatUiAmount(info.supply, info.decimals),
      decimals: info.decimals,
    },
    mintAuthority: info.mintAuthority?.toBase58() ?? null,
    freezeAuthority: info.freezeAuthority?.toBase58() ?? null,
  };
}

export async function fetchAuditLog(connection: Connection, mint: PublicKey, limit = 20) {
  const sigs = await connection.getSignaturesForAddress(mint, { limit });
  return sigs.map((s) => ({
    signature: s.signature,
    slot: s.slot,
    err: s.err,
    blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
  }));
}

// ─── Compliance / blacklist (per-mint PDA scoping) ───────────────────────────

const CONFIG_SEED = Buffer.from("config");
const BLACKLIST_SEED = Buffer.from("blacklist");

function findConfigPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED, mint.toBuffer()], programId)[0];
}

function findBlacklistPda(mint: PublicKey, wallet: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, mint.toBuffer(), wallet.toBuffer()],
    programId,
  )[0];
}

export async function buildBlacklistAddTx(
  admin: PublicKey,
  mint: PublicKey,
  wallet: PublicKey,
  hookProgramId: PublicKey,
): Promise<Transaction> {
  const configPda = findConfigPda(mint, hookProgramId);
  const blacklistPda = findBlacklistPda(mint, wallet, hookProgramId);
  const disc = await anchorDiscriminator("add_to_blacklist");
  const data = Buffer.concat([disc, wallet.toBuffer()]);

  return new Transaction().add(
    new TransactionInstruction({
      keys: [
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: hookProgramId,
      data,
    }),
  );
}

export async function buildBlacklistRemoveTx(
  admin: PublicKey,
  mint: PublicKey,
  wallet: PublicKey,
  hookProgramId: PublicKey,
): Promise<Transaction> {
  const configPda = findConfigPda(mint, hookProgramId);
  const blacklistPda = findBlacklistPda(mint, wallet, hookProgramId);
  const disc = await anchorDiscriminator("remove_from_blacklist");
  const data = Buffer.concat([disc, wallet.toBuffer()]);

  return new Transaction().add(
    new TransactionInstruction({
      keys: [
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: hookProgramId,
      data,
    }),
  );
}

export async function fetchBlacklistStatus(
  connection: Connection,
  mint: PublicKey,
  wallet: PublicKey,
  hookProgramId: PublicKey,
) {
  const pda = findBlacklistPda(mint, wallet, hookProgramId);
  const info = await connection.getAccountInfo(pda);

  // Layout: 8-byte disc | 32-byte wallet | 32-byte mint | 1-byte blocked | 1-byte bump
  if (!info || info.data.length < 8 + 32 + 32 + 1) {
    return { wallet: wallet.toBase58(), pda: pda.toBase58(), blocked: false };
  }
  const blocked = info.data[8 + 32 + 32] !== 0;
  return { wallet: wallet.toBase58(), pda: pda.toBase58(), blocked };
}
