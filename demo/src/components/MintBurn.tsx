import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAppConfig } from "../ConfigContext";
import { tokenProgramId, buildMintTx, buildBurnTx } from "../solana";
import Feedback from "./Feedback";

export default function MintBurn() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { config } = useAppConfig();

  const [mintRecipient, setMintRecipient] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function useMyWallet() {
    if (publicKey) setMintRecipient(publicKey.toBase58());
  }

  async function doMint() {
    if (!publicKey || !config.mintAddress) return;
    setOk(null); setErr(null); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      const tx = await buildMintTx(
        connection, publicKey, mint,
        new PublicKey(mintRecipient), BigInt(mintAmount), pid,
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Minted ${mintAmount} tokens. Tx: ${sig}`);
      setMintAmount("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function doBurn() {
    if (!publicKey || !config.mintAddress) return;
    setOk(null); setErr(null); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      const tx = buildBurnTx(publicKey, mint, BigInt(burnAmount), pid);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Burned ${burnAmount} tokens. Tx: ${sig}`);
      setBurnAmount("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const disabled = !publicKey || !config.mintAddress;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Mint & Burn</h2>
      <Feedback ok={ok} err={err} />

      <div className="card space-y-4">
        <h3 className="font-semibold">Mint Tokens</h3>
        <p className="text-sm text-slate-500">
          Your connected wallet signs as the mint authority. Phantom will prompt for approval.
        </p>
        <div>
          <label className="mb-1 block text-sm text-slate-500">Recipient</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Wallet public key"
              value={mintRecipient}
              onChange={(e) => setMintRecipient(e.target.value)}
            />
            {publicKey && (
              <button onClick={useMyWallet}
                className="shrink-0 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:bg-slate-100">
                My Wallet
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-500">Amount (raw units)</label>
          <input type="number" placeholder="1000000"
            value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} />
        </div>
        <button onClick={doMint}
          disabled={disabled || busy || !mintRecipient || !mintAmount}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Waiting for signature..." : "Mint"}
        </button>
      </div>

      <div className="card space-y-4">
        <h3 className="font-semibold">Burn Tokens</h3>
        <p className="text-sm text-slate-500">
          Burns from your connected wallet's associated token account.
        </p>
        <div>
          <label className="mb-1 block text-sm text-slate-500">Amount (raw units)</label>
          <input type="number" placeholder="500000"
            value={burnAmount} onChange={(e) => setBurnAmount(e.target.value)} />
        </div>
        <button onClick={doBurn}
          disabled={disabled || busy || !burnAmount}
          className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50">
          {busy ? "Waiting for signature..." : "Burn"}
        </button>
      </div>
    </div>
  );
}
