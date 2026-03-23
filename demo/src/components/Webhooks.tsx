import { useEffect, useState } from "react";
import { useAppConfig } from "../ConfigContext";
import * as api from "../api";
import Feedback from "./Feedback";

export default function Webhooks() {
  const { config } = useAppConfig();
  const base = config.backendUrl;

  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("*");
  const [secret, setSecret] = useState("");
  const [hooks, setHooks] = useState<api.Webhook[]>([]);

  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { refresh(); }, [base]);

  async function refresh() {
    try { setHooks(await api.listWebhooks(base)); } catch { /* backend offline */ }
  }

  async function doRegister() {
    setOk(null); setErr(null); setBusy(true);
    try {
      const evArr = events.split(",").map((s) => s.trim()).filter(Boolean);
      await api.registerWebhook(base, url, evArr, secret || undefined);
      setOk("Webhook registered."); setUrl(""); setSecret("");
      refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function doDelete(id: string) {
    setOk(null); setErr(null);
    try { await api.deleteWebhook(base, id); setOk("Webhook deleted."); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Webhooks</h2>
      <p className="text-sm text-slate-500">
        Register HTTP endpoints via the backend service ({base}) for real-time event notifications.
      </p>

      <Feedback ok={ok} err={err} />

      <div className="card space-y-3">
        <h3 className="font-semibold">Register Webhook</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-slate-500">URL</label>
            <input type="text" placeholder="https://your-server.com/webhook"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-500">Events (comma-separated)</label>
            <input type="text" placeholder="* or transaction.confirmed"
              value={events} onChange={(e) => setEvents(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-500">Secret (optional)</label>
          <input type="text" placeholder="Shared secret"
            value={secret} onChange={(e) => setSecret(e.target.value)} />
        </div>
        <button onClick={doRegister} disabled={busy || !url}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          Register
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Registered Webhooks</h3>
          <button onClick={refresh} className="text-sm text-indigo-600 hover:underline">Refresh</button>
        </div>
        {hooks.length === 0 ? (
          <p className="text-sm text-slate-400">No webhooks registered.</p>
        ) : (
          <div className="space-y-2">
            {hooks.map((h) => (
              <div key={h.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.url}</p>
                  <p className="text-xs text-slate-400">
                    Events: {h.events.join(", ")} &middot; {new Date(h.createdAt).toLocaleString()}
                  </p>
                </div>
                <button onClick={() => doDelete(h.id)}
                  className="ml-4 shrink-0 rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
