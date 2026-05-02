import { defineConfig } from "vite";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  plugins: [
    {
      name: "notebook-config-watcher",
      apply: "serve",
      configureServer(server) {
        const watched = [
          path.resolve(__dirname, "config.yaml"),
          path.resolve(__dirname, "templates"),
        ];
        server.watcher.add(watched);
        server.watcher.on("change", (file) => {
          const isRelevant =
            file.endsWith("config.yaml") ||
            file.includes(`${path.sep}templates${path.sep}`);
          if (!isRelevant) return;
          try {
            execSync("node scripts/build.js", {
              cwd: __dirname,
              stdio: "inherit",
            });
          } catch { /* error already printed */ }
          server.ws.send({ type: "full-reload" });
        });
      },
    },
  ],
});
