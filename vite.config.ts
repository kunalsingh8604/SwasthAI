// Node.js / Render deployment:
// - cloudflare: false disables @cloudflare/vite-plugin (Workers-only output)
// - nitro() emits a Node server that listens on process.env.PORT || 3000
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

export default defineConfig({
  cloudflare: false,
  plugins: [
    nitro({
      // Standalone Node HTTP server for Render / Docker / VPS
      preset: "node-server",
    }),
  ],
});
