export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  webhookId: string;
  event: string;
  payload: unknown;
  attempt: number;
  status: "pending" | "delivered" | "failed";
  httpStatus?: number;
  error?: string;
  timestamp: string;
}
