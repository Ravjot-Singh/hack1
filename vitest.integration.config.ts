import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/integration/test-db";

// Integration tests: real server actions against a separate, throw-away Postgres database.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl() },
    // One database, so files run one after another.
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 180000,
  },
});
