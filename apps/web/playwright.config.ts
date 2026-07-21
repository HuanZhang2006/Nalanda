import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "pnpm --filter @nalanda/types build && pnpm --filter @nalanda/api build && pnpm --filter @nalanda/api start",
      url: "http://127.0.0.1:3000/api/health", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "pnpm dev --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
