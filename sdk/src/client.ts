import { SSSError } from "./error.js";
import type {
  ApiResponse,
  AuditEntry,
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
} from "./types.js";

export class SSSClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  // ─── Core request helper ─────────────────────────────────────────────────

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

  async getAuditLog(): Promise<AuditEntry[]> {
    return this.request<AuditEntry[]>("GET", "/api/compliance/audit");
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

  async createApiKey(label?: string): Promise<ApiKeyEntry> {
    return this.request<ApiKeyEntry>("POST", "/api/admin/keys", {
      label: label ?? "unnamed",
    });
  }

  async deleteApiKey(id: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(
      "DELETE",
      `/api/admin/keys/${encodeURIComponent(id)}`
    );
  }
}
