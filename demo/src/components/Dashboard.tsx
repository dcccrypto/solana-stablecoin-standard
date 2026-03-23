import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAppConfig } from "../ConfigContext";
import { tokenProgramId, fetchStatus, fetchBalance } from "../solana";
import Feedback from "./Feedback";

export default function Dashboard() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { config } = useAppConfig();

  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchStatus>> | null>(null);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof fetchBalance>> | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, [publicKey, config.mintAddress]);

  async function refresh() {
    setErr(null);
    if (!config.mintAddress) return;
    try {
      const mint = new PublicKey(config.mintAddress);
      const pid = tokenProgramId(config.tokenProgram);
      await connection.getVersion();
      setConnected(true);
      const s = await fetchStatus(connection, mint, pid);
      setStatus(s);
      if (publicKey) {
        const b = await fetchBalance(connection, mint, publicKey, pid);
        setBalance(b);
      }
    } catch (e) {
      setConnected(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <button
          onClick={refresh}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Refresh
        </button>
      </div>

      <Feedback err={err} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="RPC"
          value={connected === null ? "..." : connected ? "Connected" : "Offline"}
          accent={connected ? "emerald" : "red"}
        />
        <StatCard
          label="Total Supply"
          value={status ? `${status.supply.uiAmount}` : "—"}
          sub={status ? `${status.supply.raw} raw` : undefined}
        />
        <StatCard
          label="Decimals"
          value={status ? String(status.supply.decimals) : "—"}
        />
        <StatCard
          label="Your Balance"
          value={balance ? `${balance.uiAmount}` : publicKey ? "—" : "Connect wallet"}
          sub={balance?.exists ? `ATA: ${balance.ata.slice(0, 8)}...` : undefined}
        />
      </div>

      {status && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            On-chain Authorities
          </h3>
          <div className="space-y-2 text-sm">
            <Row label="Mint" value={status.mint} />
            <Row label="Mint Authority" value={status.mintAuthority ?? "None (revoked)"} />
            <Row label="Freeze Authority" value={status.freezeAuthority ?? "None (revoked)"} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, sub, accent = "indigo",
}: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  const ring =
    accent === "emerald" ? "border-l-emerald-500"
      : accent === "red" ? "border-l-red-500"
        : "border-l-indigo-500";
  return (
    <div className={`card border-l-4 ${ring}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-32 shrink-0 font-medium text-slate-500">{label}</span>
      <code className="break-all rounded bg-slate-100 px-2 py-0.5 text-xs">{value}</code>
    </div>
  );
}
