import type { Request, Response, NextFunction } from "express";
import type pino from "pino";

export function errorHandler(logger: pino.Logger) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: err.message || "Internal server error" });
  };
}
