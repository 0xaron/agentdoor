import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "packages/*/src/__tests__/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**"],
      exclude: [
        "**/template/**",
        "**/examples/**",
        "**/__tests__/**",
        "**/storage/postgres.ts",
        "**/storage/sqlite.ts",
      ],
      thresholds: {
        lines: 75,
        branches: 75,
        functions: 80,
        statements: 75,
      },
    },
  },
  resolve: {
    alias: {
      "@agentdoor/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@agentdoor/express": path.resolve(__dirname, "packages/express/src/index.ts"),
      "@agentdoor/next": path.resolve(__dirname, "packages/next/src/middleware.ts"),
      "@agentdoor/hono": path.resolve(__dirname, "packages/hono/src/middleware.ts"),
      "@agentdoor/detect": path.resolve(__dirname, "packages/detect/src/index.ts"),
    },
  },
});
