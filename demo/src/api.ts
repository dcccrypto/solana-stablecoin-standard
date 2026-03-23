/**
 * Backend API client — only used for webhook management.
 * All token operations now happen client-side via Phantom signing.
 */

async function request<T>(baseUrl: string, path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export const registerWebhook = (base: string, url: string, events: string[], secret?: string) =>
  request<Webhook>(base, "/api/v1/webhooks", {
    method: "POST",
    body: JSON.stringify({ url, events, secret }),
  });

export const listWebhooks = (base: string) =>
  request<Webhook[]>(base, "/api/v1/webhooks");

export const deleteWebhook = (base: string, id: string) =>
  request<{ deleted: boolean }>(base, `/api/v1/webhooks/${id}`, { method: "DELETE" });
