import { useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAppConfig } from "../ConfigContext";
import { fetchAuditLog } from "../solana";
import Feedback from "./Feedback";

type LogEntry = Awaited<ReturnType<typeof fetchAuditLog>>[number];

export default function AuditLog() {
  const { connection } = useConnection();
  const { config } = useAppConfig();

  const [limit, setLimit] = useState("20");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!config.mintAddress) return;
    setErr(null); setBusy(true);
    try {
      const mint = new PublicKey(config.mintAddress);
      const data = await fetchAuditLog(connection, mint, Number(limit) || 20);
      setEntries(data);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const cluster = config.rpcUrl.includes("devnet")
    ? "devnet"
    : config.rpcUrl.includes("mainnet")
      ? "mainnet-beta"
      : "custom";

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Audit Log</h2>
      <p className="text-sm text-slate-500">
        Recent on-chain transactions involving the stablecoin mint — read directly from the chain.
      </p>

      <div className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-sm text-slate-500">Limit</label>
          <input type="number" className="w-24"
            value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <button onClick={load} disabled={busy || !config.mintAddress}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Loading..." : "Fetch"}
        </button>
      </div>

      <Feedback err={err} />

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Signature</th>
                <th className="px-4 py-3">Slot</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.signature} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <a
                      href={`https://explorer.solana.com/tx/${e.signature}${cluster !== "custom" ? `?cluster=${cluster}` : ""}`}
                      target="_blank" rel="noreferrer"
                      className="font-mono text-xs text-indigo-600 underline-offset-2 hover:underline">
                      {e.signature.slice(0, 20)}...
                    </a>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{e.slot}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {e.blockTime ? new Date(e.blockTime).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {e.err ? (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Failed</span>
                    ) : (
                      <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 0 && !busy && (
        <p className="text-sm text-slate-400">No entries yet. Click Fetch to load the on-chain audit log.</p>
      )}
    </div>
  );
}
