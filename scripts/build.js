#!/usr/bin/env node
/**
 * Build script: reads every YAML file in pages/, renders each to an HTML file at project root.
 * Usage: node scripts/build.js
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, copyFileSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import Handlebars from "handlebars";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATES = resolve(ROOT, "templates");
const PAGES_DIR = resolve(ROOT, "pages");

if (!existsSync(PAGES_DIR)) {
  console.error("No pages/ directory found. Create it and add YAML config files.");
  process.exit(1);
}

// ── Markdown ────────────────────────────────────────────────────────────────
marked.use({ gfm: true });

// ── Handlebars helpers ───────────────────────────────────────────────────────
const escHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");

Handlebars.registerHelper("setviewExpr", function () {
  const { id, facing = "N", elevation = "MIDDLE", displayedNodes = [] } = this;
  const nodes = displayedNodes.map((n) => `'${escHtml(n)}'`).join(",");
  return new Handlebars.SafeString(
    `$currentSection='${id}';$viewer.dispatchEvent(new CustomEvent('setview',{detail:{facing:'${facing}',elevation:'${elevation}',displayedNodes:[${nodes}]}}))`
  );
});

// ── Per-page normalization ───────────────────────────────────────────────────
function normalizePage(config) {
  config.annotations = config.annotations ?? [];
  config.tocSide = config["toc-alignment"] ?? config.tocAlignment ?? "right";

  config.chapters = (config.chapters ?? []).map((chapterObj, ci) => {
    const [chapterName, chapterData] = Object.entries(chapterObj)[0];
    const sections = (chapterData.sections ?? []).map((sectionObj, si) => {
      const [sectionName, sectionData] = Object.entries(sectionObj)[0];
      const defaultTarget = (sectionData.displayedNodes ?? [])[0] ?? "";
      const annotations = (sectionData.annotations ?? []).map((ann) => ({ target: defaultTarget, ...ann }));
      const features = (sectionData.features ?? []).map((f) => new Handlebars.SafeString(marked.parse(String(f))));
      return {
        name: sectionName,
        chapterName,
        chapterId: `chapter-${ci}`,
        id: `section-${ci}-${si}`,
        side: "right",
        ...sectionData,
        annotations,
        features,
      };
    });
    return { name: chapterName, id: `chapter-${ci}`, sections };
  });

  return config;
}

// ── Process each YAML in pages/ ──────────────────────────────────────────────
const yamlFiles = readdirSync(PAGES_DIR).filter((f) => /\.ya?ml$/.test(f));

if (yamlFiles.length === 0) {
  console.error("No YAML files found in pages/");
  process.exit(1);
}

for (const yamlFile of yamlFiles) {
  const config = normalizePage(yaml.load(readFileSync(resolve(PAGES_DIR, yamlFile), "utf8")));

  const templateName = config.template ?? "default";
  const TEMPLATE_DIR = resolve(TEMPLATES, templateName);

  readdirSync(TEMPLATE_DIR)
    .filter((f) => /\.hbs$/.test(f) && f !== "layout.hbs")
    .forEach((f) => Handlebars.registerPartial(basename(f, ".hbs"), readFileSync(resolve(TEMPLATE_DIR, f), "utf8")));

  // Copy layout-specific CSS into assets/ so Vite can resolve and bundle it
  const cssFiles = readdirSync(TEMPLATE_DIR).filter((f) => /\.css$/.test(f));
  if (cssFiles.length > 0) {
    const cssDestDir = resolve(ROOT, "assets", "css", "layouts", templateName);
    mkdirSync(cssDestDir, { recursive: true });
    cssFiles.forEach((f) => copyFileSync(resolve(TEMPLATE_DIR, f), resolve(cssDestDir, f)));
    console.log(`  copied ${cssFiles.length} CSS file(s) for template "${templateName}"`);
  }

  const layout = Handlebars.compile(readFileSync(resolve(TEMPLATE_DIR, "layout.hbs"), "utf8"));

  const outFile = yamlFile.replace(/\.ya?ml$/, ".html");
  writeFileSync(resolve(ROOT, outFile), layout(config));
  console.log(`  wrote ${outFile}`);
}

// ── Copy non-CSS assets → public/ ───────────────────────────────────────────
// CSS files are left in assets/ for Vite to resolve from HTML entry points and bundle.
const srcAssets = resolve(ROOT, "assets");
if (existsSync(srcAssets)) {
  mkdirSync(resolve(ROOT, "public"), { recursive: true });
  cpSync(srcAssets, resolve(ROOT, "public", "assets"), {
    recursive: true,
    filter: (src) => !src.endsWith(".css"),
  });
  console.log("  copied non-CSS assets → public/assets/");
}

console.log("Build complete.");
