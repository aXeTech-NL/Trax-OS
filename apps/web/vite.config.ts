import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const apiTarget = process.env.TRAX_API_PROXY ?? "http://127.0.0.1:18000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/trax.svg"],
      manifest: {
        name: "Trax OS",
        short_name: "Trax OS",
        description: "Authenticated self-hosted journey planning",
        theme_color: "#14866d",
        background_color: "#f8fbfc",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icons/trax.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
