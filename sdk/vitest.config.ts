import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default run: unit tests only (no live backend required)
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/tests/integration/**",
      "**/tests/anchor/**",
    ],
  },
});
