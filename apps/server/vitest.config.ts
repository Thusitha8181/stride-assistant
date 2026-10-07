import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.int.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Thin adapters covered by the integration suite.
      exclude: ["src/**/*.test.ts", "src/rag/qdrant.ts", "src/services.ts", "src/env.ts", "src/index.ts"],
      thresholds: { lines: 80 },
    },
  },
});
