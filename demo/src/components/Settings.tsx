import { useState } from "react";
import { useAppConfig } from "../ConfigContext";
import Feedback from "./Feedback";

export default function Settings() {
  const { config, setConfig } = useAppConfig();
  const [local, setLocal] = useState({ ...config });
  const [ok, setOk] = useState<string | null>(null);

  function save() {
    setConfig(local);
    setOk("Settings saved. Config is persisted in localStorage.");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>
      <Feedback ok={ok} />

      <div className="card space-y-5 max-w-2xl">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Solana RPC URL
          </label>
          <input type="text" value={local.rpcUrl}
            onChange={(e) => setLocal({ ...local, rpcUrl: e.target.value })} />
          <p className="mt-1 text-xs text-slate-400">
            Default: https://api.devnet.solana.com
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Mint Address
          </label>
          <input type="text" placeholder="On-chain mint public key"
            value={local.mintAddress}
            onChange={(e) => setLocal({ ...local, mintAddress: e.target.value })} />
          <p className="mt-1 text-xs text-slate-400">
            The stablecoin mint you deployed with the CLI or SDK.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Token Program
          </label>
          <select value={local.tokenProgram}
            onChange={(e) =>
              setLocal({ ...local, tokenProgram: e.target.value as "spl-token-2022" | "spl-token" })
            }>
            <option value="spl-token-2022">Token-2022 (spl-token-2022)</option>
            <option value="spl-token">SPL Token (spl-token)</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Transfer Hook Program ID{" "}
            <span className="font-normal text-slate-400">(SSS-2, optional)</span>
          </label>
          <input type="text" placeholder="Hook program public key"
            value={local.hookProgramId}
            onChange={(e) => setLocal({ ...local, hookProgramId: e.target.value })} />
          <p className="mt-1 text-xs text-slate-400">
            Required for Compliance tab (blacklist operations).
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Backend URL{" "}
            <span className="font-normal text-slate-400">(for webhooks only)</span>
          </label>
          <input type="text" value={local.backendUrl}
            onChange={(e) => setLocal({ ...local, backendUrl: e.target.value })} />
          <p className="mt-1 text-xs text-slate-400">
            The SSS backend — only needed for the Webhooks tab.
          </p>
        </div>

        <button onClick={save}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Save
        </button>
      </div>

      <div className="card max-w-2xl space-y-2 text-sm text-slate-500">
        <h3 className="font-semibold text-slate-700">How it works</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Connect Phantom</strong> — your wallet signs all on-chain
            transactions (mint, burn, freeze, blacklist, etc.).
          </li>
          <li>
            <strong>Your wallet must be the authority</strong> — e.g. to mint, it
            must be the mint authority; to freeze, the freeze authority.
          </li>
          <li>
            <strong>Read operations</strong> (supply, balance, status, audit
            log) are fetched directly from the chain — no backend needed.
          </li>
          <li>
            <strong>Webhooks</strong> go through the backend service for event
            listener and webhook dispatch.
          </li>
        </ul>
      </div>
    </div>
  );
}
