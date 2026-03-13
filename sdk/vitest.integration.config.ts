import { defineConfig } from "vitest/config";

/**
 * Used by: npx vitest run --config vitest.integration.config.ts
 *
 * Requires a live backend (SSS_TEST_BASE_URL / SSS_TEST_API_KEY env vars).
 * See the CI job `sdk-integration` in .github/workflows/ci.yml.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    // Give each test up to 30 s to account for backend cold start
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
