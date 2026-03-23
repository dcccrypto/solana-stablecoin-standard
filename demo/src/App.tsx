import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppConfig } from "./ConfigContext";

import Dashboard from "./components/Dashboard";
import MintBurn from "./components/MintBurn";
import Accounts from "./components/Accounts";
import Compliance from "./components/Compliance";
import AuditLog from "./components/AuditLog";
import Webhooks from "./components/Webhooks";
import Settings from "./components/Settings";

const TABS = [
  "Dashboard",
  "Mint & Burn",
  "Accounts",
  "Compliance",
  "Audit Log",
  "Webhooks",
  "Settings",
] as const;

type Tab = (typeof TABS)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Settings");
  const { publicKey } = useWallet();
  const { config } = useAppConfig();

  const hasMint = !!config.mintAddress;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Navbar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              S
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Solana Stablecoin Standard
            </span>
          </div>
          <div className="flex items-center gap-4">
            {publicKey && (
              <span className="hidden text-xs text-slate-500 sm:block">
                {publicKey.toBase58().slice(0, 4)}...
                {publicKey.toBase58().slice(-4)}
              </span>
            )}
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* ── Tab bar ────────────────────────────────────── */}
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-b-2 border-indigo-600 text-indigo-600"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Banner ─────────────────────────────────────── */}
      {!hasMint && tab !== "Settings" && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No mint address configured.{" "}
            <button
              onClick={() => setTab("Settings")}
              className="font-medium underline underline-offset-2"
            >
              Go to Settings
            </button>{" "}
            to set it up.
          </div>
        </div>
      )}

      {!publicKey && tab !== "Settings" && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            Connect your Phantom wallet to sign transactions.
          </div>
        </div>
      )}

      {/* ── Content ────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {tab === "Dashboard" && <Dashboard />}
        {tab === "Mint & Burn" && <MintBurn />}
        {tab === "Accounts" && <Accounts />}
        {tab === "Compliance" && <Compliance />}
        {tab === "Audit Log" && <AuditLog />}
        {tab === "Webhooks" && <Webhooks />}
        {tab === "Settings" && <Settings />}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        SSS Demo &mdash; Solana Stablecoin Standard
      </footer>
    </div>
  );
}
