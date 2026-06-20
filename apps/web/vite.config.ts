import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 本地开发：把 /api 转给本机 NestJS
    proxy: { "/api": "http://localhost:3000" },
  },
});
