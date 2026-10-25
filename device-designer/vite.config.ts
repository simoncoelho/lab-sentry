import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Opentrons App data folder; override with OPENTRONS_APP_DATA.
function opentronsAppData() {
  if (process.env.OPENTRONS_APP_DATA) return process.env.OPENTRONS_APP_DATA;
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/Opentrons");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), "Opentrons");
  return join(homedir(), ".config/Opentrons");
}

// Newest analysis JSON for each protocol the Opentrons App has imported.
function latestAnalyses() {
  const root = opentronsAppData();
  const found: { id: string; file: string; source: string; analyzedAt: number; path: string }[] = [];
  for (const store of ["protocols-9.1-plus", "protocols"]) {
    const dir = join(root, store);
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir)) {
      const analysisDir = join(dir, id, "analysis");
      if (!/^[0-9a-f-]{36}$/.test(id) || !existsSync(analysisDir)) continue;
      const latest = readdirSync(analysisDir).filter(f => f.endsWith(".json")).sort().at(-1);
      if (!latest) continue;
      const source = existsSync(join(dir, id, "src")) ? readdirSync(join(dir, id, "src")).find(f => /\.(py|json)$/.test(f)) ?? "" : "";
      const path = join(analysisDir, latest);
      if (!found.some(f => f.id === id)) found.push({ id, file: latest, source, analyzedAt: statSync(path).mtimeMs, path });
    }
  }
  return found.sort((a, b) => b.analyzedAt - a.analyzedAt);
}

// Dev-server only: read-only access to the Opentrons App's protocol analyses.
function opentronsAnalyses(): Plugin {
  return {
    name: "opentrons-app-analyses",
    configureServer(server) {
      server.middlewares.use("/opentrons-app/analyses", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        try {
          const all = latestAnalyses();
          const id = (req.url ?? "/").replace(/^\/|\?.*$/g, "");
          if (!id) {
            res.end(JSON.stringify(all.map(({ id, source, analyzedAt }) => {
              let protocolName = source;
              try { protocolName = JSON.parse(readFileSync(all.find(a => a.id === id)!.path, "utf8")).metadata?.protocolName || source; } catch { /* keep file name */ }
              return { id, source, protocolName, analyzedAt };
            })));
            return;
          }
          const match = all.find(a => a.id === id);
          if (!match) { res.statusCode = 404; res.end(JSON.stringify({ error: "No analysis for that protocol." })); return; }
          res.end(readFileSync(match.path));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not read Opentrons App data." }));
        }
      });
    },
  };
}

export default defineConfig({
  base: "./",
  server: { proxy: {
    "/camera-api": { target: "http://127.0.0.1:5101", rewrite: path => path.replace(/^\/camera-api/, "") },
    "/video-api": { target: "http://127.0.0.1:5100", rewrite: path => path.replace(/^\/video-api/, "") },
  } },
  plugins: [
    react(),
    opentronsAnalyses(),
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
