import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig(({ command }) => ({
  plugins: [preact(), crx({ manifest })],
  build: {
    outDir: command === "serve" ? "dist-dev" : "dist",
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        auth: "src/auth-page/index.html",
        history: "src/history-page/index.html",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
