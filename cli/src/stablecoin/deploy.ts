import path from "path";
import { PublicKey } from "@solana/web3.js";
import {
  SolanaStablecoin,
  Presets,
  TOKEN_2022_PROGRAM_ID,
  type TransferHookConfig,
} from "sss-token-sdk";
import {
  loadConfig,
  updateConfigMint,
  defaultConfigPath,
  type SssConfig,
} from "../config";
import { getConnection, loadKeypair } from "../solana-helpers";

/**
 * Deploys a new stablecoin via the SDK, then writes the mint address back to config.
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

  console.log("=== SSS deploy ===");
  console.log("Standard:", cfg.standard);
  console.log("Cluster:", cfg.cluster);
  console.log("Token program:", cfg.stablecoin.tokenProgram);
  console.log("Name / symbol / decimals:", name, symbol, decimals);
  if (metadataEnabled) console.log("Metadata extension: enabled");
  if (transferHookEnabled) console.log("Transfer hook extension: enabled (program:", transferHookProgramId!.toBase58() + ")");
  if (pausableEnabled) console.log("Pausable extension: enabled");
  if (permanentDelegateEnabled) console.log("Permanent delegate extension: enabled");
  if (cfg.standard === "sss-2") console.log("Default account state: frozen (new ATAs require thaw)");
  console.log("");

  const preset = cfg.standard === "sss-2" ? Presets.SSS_2 : Presets.SSS_1;

  let transferHookConfig: TransferHookConfig | undefined;
  if (transferHookEnabled) {
    const hookAdmin = cfg.authorities.blacklist?.trim()
      ? loadKeypair(cfg.authorities.blacklist)
      : payer;
    transferHookConfig = {
      programId: transferHookProgramId!,
      admin: hookAdmin,
    };
  }

  const freezeAuthority = loadKeypair(cfg.authorities.freeze);
  const metadataAuthority = metadataEnabled
    ? loadKeypair(cfg.authorities.metadata)
    : undefined;

  const stable = await SolanaStablecoin.create(connection, {
    preset,
    name,
    symbol,
    decimals,
    uri,
    authority: payer,
    freezeAuthority: freezeAuthority.publicKey,
    metadataAuthority: metadataAuthority?.publicKey,
    extensions: {
      metadata: metadataEnabled,
      pausable: pausableEnabled,
      permanentDelegate: permanentDelegateEnabled,
      transferHook: transferHookConfig ?? false,
      defaultAccountStateFrozen: cfg.standard === "sss-2",
    },
  });

  const mintAddress = stable.mint.toBase58();
  console.log("Created mint:", mintAddress);

  updateConfigMint(filePath, mintAddress);
  console.log("Updated config with mint address:", filePath);

  return {
    ...cfg,
    stablecoin: { ...cfg.stablecoin, mint: mintAddress },
  };
}
