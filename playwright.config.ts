import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chromium") },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000/login", reuseExistingServer: !process.env.CI, timeout: 120000 }
});
