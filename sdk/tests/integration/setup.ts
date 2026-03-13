/**
 * SSS-012 — Shared test setup for SDK integration tests.
 *
 * Expects the backend to be running on the URL/port specified by
 * SSS_TEST_BASE_URL (default http://localhost:9876) with a bootstrap
 * API key seeded via BOOTSTRAP_API_KEY env var.
 */

export const BASE_URL =
  process.env.SSS_TEST_BASE_URL ?? "http://127.0.0.1:9876";
export const API_KEY =
  process.env.SSS_TEST_API_KEY ?? "sss_integrationtest000000000000000000";

export const TOKEN_MINT =
  "So11111111111111111111111111111111111111112";
export const RECIPIENT =
  "RecipientAddr111111111111111111111111111111";
export const SOURCE =
  "SourceAddr1111111111111111111111111111111111";
