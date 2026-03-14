import path from "path";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  loadConfig,
  updateConfigMint,
  defaultConfigPath,
  type SssConfig,
} from "../config";
import { getConnection, loadKeypair } from "../solana-helpers";
import {
  createMint,
  createInitializeMint2Instruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferHookInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializePausableConfigInstruction,
  tokenMetadataInitialize,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
} from "@solana/spl-token";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { initializeBlacklistHook } from "./blacklist";

/**
 * Deploys a new SPL mint from config: creates the mint on-chain (with optional
 * Token-2022 extensions), then updates the config file with the new mint address.
 *
 * Token-2022 with metadata follows the working pattern:
 * - Allocate only for extensions; fund with enough lamports for the final size
 *   (metadata reallocs, so we use a generous estimate for rent).
 * - Tx1: CreateAccount → extension inits → InitializeMint2.
 * - Tx2: tokenMetadataInitialize (reallocs mint and writes name/symbol/uri).
 */
export async function deployStablecoinFromConfig(
  configPath?: string,
): Promise<SssConfig> {
  const cfg = loadConfig(configPath);
  const filePath = configPath
    ? path.resolve(process.cwd(), configPath)
    : defaultConfigPath();

  if (cfg.stablecoin.mint && cfg.stablecoin.mint.trim() !== "") {
    throw new Error(
      "Config already has a mint address. Use a config with mint = \"\" to deploy a new token.",
    );
  }

  const connection = getConnection(cfg);
  const payer = loadKeypair(cfg.authorities.mint);
  const mintAuthority = payer.publicKey;
  const freezeKeypair = loadKeypair(cfg.authorities.freeze);
  const freezeAuthority = freezeKeypair.publicKey;
  const decimals = cfg.stablecoin.decimals;
  const name = cfg.stablecoin.name;
  const symbol = cfg.stablecoin.symbol;
  const uri = cfg.stablecoin.uri ?? "";

  const useToken2022 = cfg.stablecoin.tokenProgram === "spl-token-2022";
  const metadataEnabled =
    useToken2022 && (cfg.extensions?.metadata?.enabled === true);
  const transferHookEnabled =
    useToken2022 && (cfg.extensions?.transferHook?.enabled === true);
  const pausableEnabled =
    useToken2022 && (cfg.extensions?.pausable?.enabled === true);
  const permanentDelegateEnabled =
    useToken2022 && (cfg.extensions?.permanentDelegate?.enabled === true);
  const transferHookProgramId = transferHookEnabled
    ? new PublicKey(cfg.extensions!.transferHook!.programId)
    : null;

  if (transferHookEnabled && !cfg.extensions?.transferHook?.programId?.trim()) {
    throw new Error(
      "Transfer hook is enabled but [extensions.transferHook] programId is empty. " +
      "Set it to your deployed blacklist_hook program ID.",
    );
  }

  if (cfg.standard === "sss-2" && !transferHookEnabled) {
    throw new Error(
      "SSS-2 requires [extensions.transferHook] enabled = true. " +
      "Enable it or use standard = \"sss-1\".",
    );
  }

  const programId = useToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  console.log("=== SSS deploy ===");
  console.log("Standard:", cfg.standard);
  console.log("Cluster:", cfg.cluster);
  console.log("Token program:", cfg.stablecoin.tokenProgram);
  console.log(
    "Name / symbol / decimals:",
    name,
    symbol,
    decimals,
  );
  if (metadataEnabled) {
    console.log("Metadata extension: enabled (on-mint name, symbol, uri)");
  }
  if (transferHookEnabled) {
    console.log("Transfer hook extension: enabled (program:", transferHookProgramId!.toBase58() + ")");
  }
  if (pausableEnabled) {
    console.log("Pausable extension: enabled");
  }
  if (permanentDelegateEnabled) {
    console.log("Permanent delegate extension: enabled");
  }
  console.log("");

  let mintAddress: string;

  const needsExtensions = metadataEnabled || transferHookEnabled || pausableEnabled || permanentDelegateEnabled;
  if (needsExtensions) {
    const metadataAuthority = metadataEnabled
      ? loadKeypair(cfg.authorities.metadata).publicKey
      : null;
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    const extensions: ExtensionType[] = [];
    if (metadataEnabled) extensions.push(ExtensionType.MetadataPointer);
    if (transferHookEnabled) extensions.push(ExtensionType.TransferHook);
    if (pausableEnabled) extensions.push(ExtensionType.PausableConfig);
    if (permanentDelegateEnabled) extensions.push(ExtensionType.PermanentDelegate);

    const mintSpace = getMintLen(extensions);
    // Use generous rent for metadata realloc; metadata init will expand the account
    const rentSize = metadataEnabled ? Math.max(mintSpace, 4096) : mintSpace;
    const lamports = await connection.getMinimumBalanceForRentExemption(rentSize);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        space: mintSpace,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    );

    if (metadataEnabled) {
      tx.add(
        createInitializeMetadataPointerInstruction(
          mint,
          metadataAuthority!,
          mint,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
    }

    if (transferHookEnabled) {
      const hookAuthority = cfg.authorities.blacklist?.trim()
        ? loadKeypair(cfg.authorities.blacklist).publicKey
        : payer.publicKey;
      tx.add(
        createInitializeTransferHookInstruction(
          mint,
          hookAuthority,
          transferHookProgramId!,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
    }

    if (permanentDelegateEnabled) {
      tx.add(
        createInitializePermanentDelegateInstruction(
          mint,
          payer.publicKey,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
    }

    if (pausableEnabled) {
      tx.add(
        createInitializePausableConfigInstruction(
          mint,
          payer.publicKey,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
    }

    tx.add(
      createInitializeMint2Instruction(
        mint,
        decimals,
        mintAuthority,
        freezeAuthority,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair], {
      commitment: "confirmed",
    });

    if (metadataEnabled) {
      await tokenMetadataInitialize(
        connection,
        payer,
        mint,
        metadataAuthority!,
        payer,
        name,
        symbol,
        uri,
        [],
        { commitment: "confirmed" },
        TOKEN_2022_PROGRAM_ID,
      );
    }

    if (transferHookEnabled) {
      console.log("Initializing blacklist hook on-chain...");
      const blacklistAdmin = cfg.authorities.blacklist?.trim()
        ? loadKeypair(cfg.authorities.blacklist)
        : payer;
      await initializeBlacklistHook(connection, transferHookProgramId!, blacklistAdmin, mint);
    }

    mintAddress = mint.toBase58();
  } else {
    const mint = await createMint(
      connection,
      payer,
      mintAuthority,
      freezeAuthority,
      decimals,
      undefined,
      undefined,
      programId,
    );
    mintAddress = mint.toBase58();
  }

  console.log("Created mint:", mintAddress);

  updateConfigMint(filePath, mintAddress);
  console.log("Updated config with mint address:", filePath);

  return {
    ...cfg,
    stablecoin: { ...cfg.stablecoin, mint: mintAddress },
  };
}
