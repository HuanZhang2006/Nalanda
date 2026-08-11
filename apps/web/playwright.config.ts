import { defineConfig, devices, type WebServerConfig } from "@playwright/test";

const webServer: WebServerConfig[] = [
  { command: "pnpm --filter @nalanda/types build && pnpm --filter @nalanda/api build && pnpm --filter @nalanda/api start",
    url: "http://127.0.0.1:3000/api/health", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  { command: "pnpm dev --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
];

if (process.env.RUN_MATERIAL_AI_PLAYWRIGHT === "1") {
  webServer.unshift({
    command: "cd ../ai && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log",
    url: "http://127.0.0.1:8000/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  });
}

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
  webServer,
});
