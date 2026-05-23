import { defineConfig } from "vite";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, existsSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.resolve(__dirname, "pages");

// Derive rollup input entries from pages/*.yaml → *.html at project root
function getPageInputs() {
  if (!existsSync(PAGES_DIR)) return { index: path.resolve(__dirname, "index.html") };
  return Object.fromEntries(
    readdirSync(PAGES_DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f.replace(/\.ya?ml$/, ""), path.resolve(__dirname, f.replace(/\.ya?ml$/, ".html"))])
  );
}

export default defineConfig({
  base: "./",
  publicDir: path.resolve(__dirname, "public"),
  server: {
    watch: {
      ignored: [path.resolve(__dirname, "example.html")],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: getPageInputs(),
    },
  },
  plugins: [
    {
      name: "notebook-config-watcher",
      apply: "serve",
      configureServer(server) {
        server.watcher.add([PAGES_DIR, path.resolve(__dirname, "templates")]);
        server.watcher.on("change", (file) => {
          const isRelevant =
            file.startsWith(PAGES_DIR) ||
            file.includes(`${path.sep}templates${path.sep}`);
          if (!isRelevant) return;
          try {
            execSync("node scripts/build.js", { cwd: __dirname, stdio: "inherit" });
          } catch { /* error already printed */ }
          server.ws.send({ type: "full-reload" });
        });
      },
    },
  ],
});
