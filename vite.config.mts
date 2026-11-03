import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "web",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/viajes": "http://localhost:8080",
      "/choferes": "http://localhost:8080",
      "/estimaciones": "http://localhost:8080",
      "/health": "http://localhost:8080",
      "/ready": "http://localhost:8080",
      "/auth": "http://localhost:9099",
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "web/src"),
    },
  },
});
