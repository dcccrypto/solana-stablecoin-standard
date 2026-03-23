import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAppConfig } from "../ConfigContext";
import {
  buildBlacklistAddTx,
  buildBlacklistRemoveTx,
  fetchBlacklistStatus,
} from "../solana";
import Feedback from "./Feedback";

export default function Compliance() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { config } = useAppConfig();

  const [addWallet, setAddWallet] = useState("");
  const [rmWallet, setRmWallet] = useState("");
  const [checkWallet, setCheckWallet] = useState("");
  const [checkResult, setCheckResult] = useState<{ blocked: boolean; pda: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const noHook = !config.hookProgramId;
  const disabled = !publicKey || !config.mintAddress || noHook;

  function clear() { setOk(null); setErr(null); setCheckResult(null); }

  async function doAdd() {
    if (disabled) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const hookPid = new PublicKey(config.hookProgramId);
      const tx = await buildBlacklistAddTx(publicKey!, mint, new PublicKey(addWallet), hookPid);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Wallet blacklisted. Tx: ${sig}`);
      setAddWallet("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function doRemove() {
    if (disabled) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const hookPid = new PublicKey(config.hookProgramId);
      const tx = await buildBlacklistRemoveTx(publicKey!, mint, new PublicKey(rmWallet), hookPid);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Wallet removed from blacklist. Tx: ${sig}`);
      setRmWallet("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function doCheck() {
    if (!config.hookProgramId) return;
    clear(); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const hookPid = new PublicKey(config.hookProgramId);
      const res = await fetchBlacklistStatus(connection, mint, new PublicKey(checkWallet), hookPid);
      setCheckResult({ blocked: res.blocked, pda: res.pda });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Compliance — Blacklist (SSS-2)</h2>

      {noHook && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No transfer hook program ID configured. Set it in{" "}
          <strong>Settings</strong> to enable compliance operations.
        </div>
      )}

      <p className="text-sm text-slate-500">
        Manage the on-chain blacklist via the transfer hook program. Your connected wallet signs as the blacklist admin.
      </p>

      <Feedback ok={ok} err={err} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h3 className="font-semibold text-red-700">Add to Blacklist</h3>
          <div>
            <label className="mb-1 block text-sm text-slate-500">Wallet</label>
            <input type="text" placeholder="Public key"
              value={addWallet} onChange={(e) => setAddWallet(e.target.value)} />
          </div>
          <button onClick={doAdd} disabled={disabled || busy || !addWallet}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? "Signing..." : "Blacklist"}
          </button>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-emerald-700">Remove from Blacklist</h3>
          <div>
            <label className="mb-1 block text-sm text-slate-500">Wallet</label>
            <input type="text" placeholder="Public key"
              value={rmWallet} onChange={(e) => setRmWallet(e.target.value)} />
          </div>
          <button onClick={doRemove} disabled={disabled || busy || !rmWallet}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "Signing..." : "Remove"}
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold">Check Blacklist Status</h3>
        <div className="flex gap-2">
          <input type="text" placeholder="Wallet public key"
            value={checkWallet} onChange={(e) => setCheckWallet(e.target.value)} />
          <button onClick={doCheck} disabled={noHook || busy || !checkWallet}
            className="shrink-0 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            Check
          </button>
        </div>
        {checkResult !== null && (
          <div className={`rounded-lg p-4 text-sm ${
            checkResult.blocked
              ? "border border-red-200 bg-red-50 text-red-800"
              : "border border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}>
            <p className="text-lg font-semibold">
              {checkResult.blocked ? "Blocked" : "Not Blocked"}
            </p>
            <p className="mt-1 text-xs opacity-70">PDA: <code>{checkResult.pda}</code></p>
          </div>
        )}
      </div>
    </div>
  );
}
