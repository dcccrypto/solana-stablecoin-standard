import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import type { ComplianceService } from "../services/compliance";

export function complianceRoutes(complianceService: ComplianceService): Router {
  const router = Router();

  router.post("/api/v1/compliance/blacklist", async (req, res, next) => {
    try {
      const { wallet, reason } = req.body;
      if (!wallet) {
        res.status(400).json({ error: "wallet is required." });
        return;
      }
      try { new PublicKey(wallet); } catch {
        res.status(400).json({ error: "Invalid wallet public key." });
        return;
      }
      const result = await complianceService.blacklistAdd(wallet, reason);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.delete("/api/v1/compliance/blacklist/:wallet", async (req, res, next) => {
    try {
      const { wallet } = req.params;
      try { new PublicKey(wallet); } catch {
        res.status(400).json({ error: "Invalid wallet public key." });
        return;
      }
      const reason = req.query.reason as string | undefined;
      const result = await complianceService.blacklistRemove(wallet, reason);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.get("/api/v1/compliance/blacklist/:wallet", async (req, res, next) => {
    try {
      const { wallet } = req.params;
      try { new PublicKey(wallet); } catch {
        res.status(400).json({ error: "Invalid wallet public key." });
        return;
      }
      const status = await complianceService.isBlacklisted(wallet);
      res.json({
        wallet: status.wallet.toBase58(),
        pda: status.pda.toBase58(),
        blocked: status.blocked,
      });
    } catch (err) { next(err); }
  });

  return router;
}
