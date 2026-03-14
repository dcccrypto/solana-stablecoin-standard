import { defineConfig } from "vitest/config";

/**
 * SSS-017 — Vitest config for SDK ↔ Anchor localnet integration tests.
 *
 * Usage:
 *   npm run test:anchor
 *
 * Requires solana-test-validator available in PATH (or ~/.local/share/solana/).
 * The setup.ts file starts and stops the validator automatically.
 *
 * Set ANCHOR_PROVIDER_URL to override the default http://127.0.0.1:8899.
 */
export default defineConfig({
  test: {
    include: ["tests/anchor/**/*.test.ts"],
    // Validator startup (beforeAll) + on-chain tx confirmation can be slow
    testTimeout: 60_000,
    hookTimeout: 90_000,
    // Single-fork: tests share one Node.js process so module-level state
    // (provider, stablecoin instance, recipientAta) persists across tests
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
