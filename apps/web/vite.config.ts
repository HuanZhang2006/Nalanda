import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
  server: {
    // Local development: proxy /api to the local NestJS server
    proxy: { "/api": "http://localhost:3000" },
  },
});
