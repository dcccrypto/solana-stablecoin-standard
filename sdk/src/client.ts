import { SSSError } from "./error";
import type {
  ApiResponse,
  AuditEntry,
  AuditQuery,
  BlacklistEntry,
  BlacklistRequest,
  BurnEvent,
  BurnRequest,
  EventsResponse,
  HealthData,
  MintEvent,
  MintRequest,
  ApiKeyEntry,
  ApiKeyListEntry,
  SupplyResponse,
  WebhookEntry,
  WebhookRequest,
} from "./api-types";

/**
 * REST API client for the SSS backend.
 *
 * @example
 * ```ts
 * const client = new SSSClient("http://localhost:8080", "sss_mykey...");
 * const health = await client.health();
 * ```
 */
export class SSSClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "X-Api-Key": this.apiKey,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let envelope: ApiResponse<T>;
    try {
      envelope = (await res.json()) as ApiResponse<T>;
    } catch {
      throw new SSSError(
        `Unexpected non-JSON response (HTTP ${res.status})`,
        res.status
      );
    }

    if (!res.ok || !envelope.success) {
      throw new SSSError(
        envelope.error ?? `Request failed with status ${res.status}`,
        res.status
      );
    }

    return envelope.data as T;
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  async health(): Promise<HealthData> {
    const url = `${this.baseUrl}/api/health`;
    const res = await fetch(url);
    const envelope = (await res.json()) as ApiResponse<HealthData>;
    if (!envelope.success || !envelope.data) {
      throw new SSSError(envelope.error ?? "Health check failed", res.status);
    }
    return envelope.data;
  }

  // ─── Mint ────────────────────────────────────────────────────────────────

  async mint(req: MintRequest): Promise<MintEvent> {
    return this.request<MintEvent>("POST", "/api/mint", req);
  }

  // ─── Burn ────────────────────────────────────────────────────────────────

  async burn(req: BurnRequest): Promise<BurnEvent> {
    return this.request<BurnEvent>("POST", "/api/burn", req);
  }

  // ─── Supply ──────────────────────────────────────────────────────────────

  async getSupply(tokenMint?: string): Promise<SupplyResponse> {
    const qs = tokenMint
      ? `?token_mint=${encodeURIComponent(tokenMint)}`
      : "";
    return this.request<SupplyResponse>("GET", `/api/supply${qs}`);
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  async getEvents(tokenMint?: string, limit?: number): Promise<EventsResponse> {
    const params = new URLSearchParams();
    if (tokenMint) params.set("token_mint", tokenMint);
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<EventsResponse>("GET", `/api/events${qs}`);
  }

  // ─── Compliance: blacklist ────────────────────────────────────────────────

  async getBlacklist(): Promise<BlacklistEntry[]> {
    return this.request<BlacklistEntry[]>("GET", "/api/compliance/blacklist");
  }

  async addToBlacklist(req: BlacklistRequest): Promise<BlacklistEntry> {
    return this.request<BlacklistEntry>(
      "POST",
      "/api/compliance/blacklist",
      req
    );
  }

  async removeFromBlacklist(
    id: string
  ): Promise<{ removed: boolean; id: string }> {
    return this.request<{ removed: boolean; id: string }>(
      "DELETE",
      `/api/compliance/blacklist/${encodeURIComponent(id)}`
    );
  }

  // ─── Compliance: audit log ────────────────────────────────────────────────

  /**
   * Retrieve compliance audit log entries.
   *
   * All parameters are optional. When omitted the backend returns the 100
   * most recent entries (max 1 000).
   *
   * @param query.address  Exact-match filter on the recorded wallet/contract address.
   * @param query.action   Filter by action type, e.g. `"BLACKLIST_ADD"`, `"BLACKLIST_REMOVE"`.
   * @param query.limit    Maximum number of entries (1–1000). Defaults to 100.
   *
   * @example
   * // All recent entries
   * const all = await client.getAuditLog();
   *
   * // Only entries for a specific address
   * const forAddr = await client.getAuditLog({ address: "So1111..." });
   *
   * // Latest 10 BLACKLIST_ADD actions
   * const adds = await client.getAuditLog({ action: "BLACKLIST_ADD", limit: 10 });
   */
  async getAuditLog(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const params = new URLSearchParams();
    if (query.address) params.set("address", query.address);
    if (query.action) params.set("action", query.action);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<AuditEntry[]>("GET", `/api/compliance/audit${qs}`);
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────

  async getWebhooks(): Promise<WebhookEntry[]> {
    return this.request<WebhookEntry[]>("GET", "/api/webhooks");
  }

  async addWebhook(req: WebhookRequest): Promise<WebhookEntry> {
    return this.request<WebhookEntry>("POST", "/api/webhooks", req);
  }

  async deleteWebhook(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.request<{ deleted: boolean; id: string }>(
      "DELETE",
      `/api/webhooks/${encodeURIComponent(id)}`
    );
  }

  // ─── API key management ───────────────────────────────────────────────────

  async listApiKeys(): Promise<ApiKeyListEntry[]> {
    const data = await this.request<{ api_keys: ApiKeyListEntry[] }>(
      "GET",
      "/api/admin/keys"
    );
    return data.api_keys;
  }

  /**
   * Create a new API key.
   *
   * @warning **Admin key required.** This endpoint requires an API key with
   * admin-level privileges (`X-Api-Key` must be an admin key, not a standard
   * read/write key). Calling this with a non-admin key will result in a 403
   * Forbidden error. Treat admin keys as highly sensitive credentials and
   * never expose them in client-side code.
   *
   * @param label - Optional human-readable label for the new key.
   */
  async createApiKey(label?: string): Promise<ApiKeyEntry> {
    return this.request<ApiKeyEntry>("POST", "/api/admin/keys", {
      label: label ?? "unnamed",
    });
  }

  /**
   * Delete an API key by ID.
   *
   * @warning **Admin key required.** This endpoint requires an API key with
   * admin-level privileges (`X-Api-Key` must be an admin key). Calling this
   * with a non-admin key will result in a 403 Forbidden error.
   *
   * @param id - The ID of the API key to delete.
   */
  async deleteApiKey(id: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(
      "DELETE",
      `/api/admin/keys/${encodeURIComponent(id)}`
    );
  }
}
