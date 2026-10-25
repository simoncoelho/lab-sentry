import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codexCopilot } from "./codex-copilot.mjs";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  server: { proxy: {
    "/camera-api": { target: "http://127.0.0.1:5101", rewrite: path => path.replace(/^\/camera-api/, "") },
    "/video-api": { target: "http://127.0.0.1:5100", rewrite: path => path.replace(/^\/video-api/, "") },
  } },
  plugins: [
    codexCopilot(),
    react(),
    {
      name: "include-urdf-assets",
      closeBundle() {
        cpSync(
          fileURLToPath(new URL("./models", import.meta.url)),
          fileURLToPath(new URL("./dist/models", import.meta.url)),
          { recursive: true },
        );
      },
    },
  ],
});
