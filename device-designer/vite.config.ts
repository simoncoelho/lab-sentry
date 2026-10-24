import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [
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
