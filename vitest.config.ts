import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Unit and property tests only; integration (tests/integration) and e2e have their own runners.
  test: { environment: "node", testTimeout: 60000, include: ["src/**/*.test.ts"] },
});
