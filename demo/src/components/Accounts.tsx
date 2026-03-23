import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAppConfig } from "../ConfigContext";
import {
  tokenProgramId,
  buildFreezeTx,
  buildThawTx,
  buildSetAuthorityTx,
  fetchBalance,
} from "../solana";
import Feedback from "./Feedback";

const AUTHORITY_TYPES = [
  "mint", "freeze", "metadata", "metadata-pointer", "pause",
  "permanent-delegate", "close-mint", "interest-rate",
];

export default function Accounts() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { config } = useAppConfig();

  const [freezeAddr, setFreezeAddr] = useState("");
  const [thawAddr, setThawAddr] = useState("");
  const [authType, setAuthType] = useState("freeze");
  const [newAuth, setNewAuth] = useState("");

  const [balanceAddr, setBalanceAddr] = useState("");
  const [balanceResult, setBalanceResult] = useState<Awaited<ReturnType<typeof fetchBalance>> | null>(null);

  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const disabled = !publicKey || !config.mintAddress;

  function clear() { setOk(null); setErr(null); }

  async function doFreeze() {
    if (disabled) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      const tx = buildFreezeTx(mint, new PublicKey(freezeAddr), publicKey!, pid);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Frozen. Tx: ${sig}`);
      setFreezeAddr("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function doThaw() {
    if (disabled) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      const tx = buildThawTx(mint, new PublicKey(thawAddr), publicKey!, pid);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Thawed. Tx: ${sig}`);
      setThawAddr("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function doSetAuth() {
    if (disabled) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      const newPk = newAuth.trim() ? new PublicKey(newAuth) : null;
      const tx = buildSetAuthorityTx(mint, publicKey!, authType, newPk, pid);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Authority updated. Tx: ${sig}`);
      setNewAuth("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function doBalance() {
    if (!config.mintAddress) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      const res = await fetchBalance(connection, mint, new PublicKey(balanceAddr), pid);
      setBalanceResult(res);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Account Management</h2>
      <Feedback ok={ok} err={err} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h3 className="font-semibold text-blue-700">Freeze Account</h3>
          <div>
            <label className="mb-1 block text-sm text-slate-500">Token Account</label>
            <input type="text" placeholder="Token account address"
              value={freezeAddr} onChange={(e) => setFreezeAddr(e.target.value)} />
          </div>
          <button onClick={doFreeze} disabled={disabled || busy || !freezeAddr}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Signing..." : "Freeze"}
          </button>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-teal-700">Thaw Account</h3>
          <div>
            <label className="mb-1 block text-sm text-slate-500">Token Account</label>
            <input type="text" placeholder="Token account address"
              value={thawAddr} onChange={(e) => setThawAddr(e.target.value)} />
          </div>
          <button onClick={doThaw} disabled={disabled || busy || !thawAddr}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Signing..." : "Thaw"}
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold">Check Balance</h3>
        <div className="flex gap-2">
          <input type="text" placeholder="Wallet public key"
            value={balanceAddr} onChange={(e) => setBalanceAddr(e.target.value)} />
          <button onClick={doBalance} disabled={busy || !balanceAddr || !config.mintAddress}
            className="shrink-0 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            Check
          </button>
        </div>
        {balanceResult && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
            <p><span className="text-slate-500">Balance:</span> <strong>{balanceResult.uiAmount}</strong> ({balanceResult.raw} raw)</p>
            <p><span className="text-slate-500">ATA:</span> <code className="text-xs">{balanceResult.ata}</code></p>
            <p><span className="text-slate-500">Exists:</span> {balanceResult.exists ? "Yes" : "No"}</p>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold">Set Authority</h3>
        <p className="text-sm text-slate-500">
          Phantom will prompt to sign the authority change.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-500">Authority Type</label>
            <select value={authType} onChange={(e) => setAuthType(e.target.value)}>
              {AUTHORITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-500">New Authority (empty to revoke)</label>
            <input type="text" placeholder="Public key or leave empty"
              value={newAuth} onChange={(e) => setNewAuth(e.target.value)} />
          </div>
        </div>
        <button onClick={doSetAuth} disabled={disabled || busy}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {busy ? "Signing..." : "Update Authority"}
        </button>
      </div>
    </div>
  );
}
