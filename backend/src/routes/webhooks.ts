import { Router } from "express";
import type { WebhookService } from "../services/webhook";

export function webhookRoutes(webhookService: WebhookService): Router {
  const router = Router();

  router.post("/api/v1/webhooks", (req, res) => {
    const { url, events, secret } = req.body;
    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      res.status(400).json({ error: "url and events[] are required." });
      return;
    }
    try { new URL(url); } catch {
      res.status(400).json({ error: "Invalid url." });
      return;
    }
    const wh = webhookService.register(url, events, secret);
    res.status(201).json(wh);
  });

  router.get("/api/v1/webhooks", (_req, res) => {
    res.json(webhookService.list());
  });

  router.get("/api/v1/webhooks/:id", (req, res) => {
    const wh = webhookService.get(req.params.id);
    if (!wh) {
      res.status(404).json({ error: "Webhook not found." });
      return;
    }
    res.json(wh);
  });

  router.delete("/api/v1/webhooks/:id", (req, res) => {
    const ok = webhookService.remove(req.params.id);
    res.status(ok ? 200 : 404).json({ deleted: ok });
  });

  router.get("/api/v1/webhooks/:id/deliveries", (req, res) => {
    const wh = webhookService.get(req.params.id);
    if (!wh) {
      res.status(404).json({ error: "Webhook not found." });
      return;
    }
    res.json(webhookService.getDeliveries(req.params.id));
  });

  return router;
}
