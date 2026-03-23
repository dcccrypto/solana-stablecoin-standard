import { Router } from "express";
import type { MintBurnService } from "../services/mint-burn";
import type { SolanaContext } from "../solana";
import { PublicKey } from "@solana/web3.js";

export function mintRoutes(ctx: SolanaContext, mintBurnService: MintBurnService): Router {
  const router = Router();

  router.post("/api/v1/mint", async (req, res, next) => {
    try {
      const { recipient, amount } = req.body;
      if (!recipient || !amount) {
        res.status(400).json({ error: "recipient and amount are required." });
        return;
      }
      try { new PublicKey(recipient); } catch {
        res.status(400).json({ error: "Invalid recipient public key." });
        return;
      }
      const result = await mintBurnService.mint(recipient, String(amount));
      res.json(result);
    } catch (err) { next(err); }
  });

  router.post("/api/v1/burn", async (req, res, next) => {
    try {
      const { amount } = req.body;
      if (!amount) {
        res.status(400).json({ error: "amount is required." });
        return;
      }
      const result = await mintBurnService.burn(String(amount));
      res.json(result);
    } catch (err) { next(err); }
  });

  router.get("/api/v1/supply", async (_req, res, next) => {
    try {
      const supply = await ctx.stablecoin.getSupply();
      res.json({ raw: supply.raw.toString(), uiAmount: supply.uiAmount, uiAmountString: supply.uiAmountString, decimals: supply.decimals });
    } catch (err) { next(err); }
  });

  router.get("/api/v1/balance/:wallet", async (req, res, next) => {
    try {
      const { wallet } = req.params;
      try { new PublicKey(wallet); } catch {
        res.status(400).json({ error: "Invalid wallet public key." });
        return;
      }
      const balance = await ctx.stablecoin.getBalance(new PublicKey(wallet));
      res.json({
        wallet,
        ata: balance.ata.toBase58(),
        raw: balance.raw.toString(),
        uiAmount: balance.uiAmount,
        uiAmountString: balance.uiAmountString,
        exists: balance.exists,
      });
    } catch (err) { next(err); }
  });

  return router;
}
