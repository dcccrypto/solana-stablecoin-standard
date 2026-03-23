import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import type { SolanaContext } from "../solana";
import type { AuthorityKind } from "sss-token-sdk";

export function tokenRoutes(ctx: SolanaContext): Router {
  const router = Router();

  router.get("/api/v1/status", async (_req, res, next) => {
    try {
      const status = await ctx.stablecoin.getStatus();
      res.json({
        mint: status.mint.toBase58(),
        supply: {
          raw: status.supply.raw.toString(),
          uiAmount: status.supply.uiAmount,
          uiAmountString: status.supply.uiAmountString,
          decimals: status.supply.decimals,
        },
        mintAuthority: status.mintAuthority?.toBase58() ?? null,
        freezeAuthority: status.freezeAuthority?.toBase58() ?? null,
      });
    } catch (err) { next(err); }
  });

  router.post("/api/v1/freeze", async (req, res, next) => {
    try {
      const { tokenAccount } = req.body;
      if (!tokenAccount) {
        res.status(400).json({ error: "tokenAccount is required." });
        return;
      }
      const sig = await ctx.stablecoin.freeze({
        tokenAccount: new PublicKey(tokenAccount),
        freezeAuthority: ctx.authority,
      });
      res.json({ txSignature: sig });
    } catch (err) { next(err); }
  });

  router.post("/api/v1/thaw", async (req, res, next) => {
    try {
      const { tokenAccount } = req.body;
      if (!tokenAccount) {
        res.status(400).json({ error: "tokenAccount is required." });
        return;
      }
      const sig = await ctx.stablecoin.thaw({
        tokenAccount: new PublicKey(tokenAccount),
        freezeAuthority: ctx.authority,
      });
      res.json({ txSignature: sig });
    } catch (err) { next(err); }
  });

  router.post("/api/v1/set-authority", async (req, res, next) => {
    try {
      const { type, newAuthority } = req.body;
      if (!type) {
        res.status(400).json({ error: "type is required." });
        return;
      }
      const sig = await ctx.stablecoin.setAuthority({
        type: type as AuthorityKind,
        currentAuthority: ctx.authority,
        newAuthority: newAuthority && newAuthority !== "none"
          ? new PublicKey(newAuthority)
          : null,
      });
      res.json({ txSignature: sig });
    } catch (err) { next(err); }
  });

  router.get("/api/v1/audit-log", async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const log = await ctx.stablecoin.getAuditLog(limit);
      res.json(log.map((e) => ({
        signature: e.signature,
        slot: e.slot,
        err: e.err,
        blockTime: e.blockTime?.toISOString() ?? null,
      })));
    } catch (err) { next(err); }
  });

  return router;
}
