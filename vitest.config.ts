import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@agentgate/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@agentgate/express": path.resolve(__dirname, "packages/express/src/index.ts"),
      "@agentgate/next": path.resolve(__dirname, "packages/next/src/middleware.ts"),
      "@agentgate/hono": path.resolve(__dirname, "packages/hono/src/middleware.ts"),
    },
  },
});
