import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.local")) loadEnvFile(".env.local");

export default defineConfig({
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000 }
});
