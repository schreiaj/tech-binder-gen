#!/usr/bin/env node
/**
 * Build script: reads config.yaml, renders Handlebars templates → index.html
 * Usage: node scripts/build.js [path/to/config.yaml]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import Handlebars from "handlebars";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATES = resolve(ROOT, "templates");

// Load config
const configPath = resolve(ROOT, process.argv.find((a) => a.endsWith(".yaml")) ?? "config.yaml");
if (!existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  console.error("Copy config.example.yaml to config.yaml and edit it.");
  process.exit(1);
}

const config = yaml.load(readFileSync(configPath, "utf8"));

// Load templates using the template name from config (defaults to "default")
const TEMPLATE_DIR = resolve(TEMPLATES, config.template ?? "default");
marked.use({ gfm: true });

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
Handlebars.registerHelper("setviewExpr", function () {
  const { id, facing = "N", elevation = "MIDDLE", displayedNodes = [] } = this;
  const nodes = displayedNodes.map((n) => `'${escHtml(n)}'`).join(",");
  return new Handlebars.SafeString(
    `$currentSection='${id}';$viewer.dispatchEvent(new CustomEvent('setview',{detail:{facing:'${facing}',elevation:'${elevation}',displayedNodes:[${nodes}]}}))`
  );
});
Handlebars.registerPartial("section", readFileSync(resolve(TEMPLATE_DIR, "section.hbs"), "utf8"));
const layout = Handlebars.compile(readFileSync(resolve(TEMPLATE_DIR, "layout.hbs"), "utf8"));

// Normalize root-level annotations
config.annotations = (config.annotations ?? []);

// Normalize chapters: [{ChapterName: {sections: [{SectionName: {...}}]}}]
// → [{name, id, sections: [{name, chapterName, chapterId, id, ...sectionData}]}]
config.chapters = (config.chapters ?? []).map((chapterObj, ci) => {
  const [chapterName, chapterData] = Object.entries(chapterObj)[0];
  const sections = (chapterData.sections ?? []).map((sectionObj, si) => {
    const [sectionName, sectionData] = Object.entries(sectionObj)[0];
    const defaultTarget = (sectionData.displayedNodes ?? [])[0] ?? "";
    const annotations = (sectionData.annotations ?? []).map((ann) => ({ target: defaultTarget, ...ann }));
    const features = (sectionData.features ?? []).map((f) => new Handlebars.SafeString(marked.parse(String(f))));
    return { name: sectionName, chapterName, chapterId: `chapter-${ci}`, id: `section-${ci}-${si}`, ...sectionData, annotations, features };
  });
  return { name: chapterName, id: `chapter-${ci}`, sections };
});

// Render index.html at project root (Vite's entry point for both dev and build)
writeFileSync(resolve(ROOT, "index.html"), layout(config));
console.log("  wrote index.html");

// Copy assets → public/ (Vite's publicDir — served at /assets/... in dev, copied to dist/ on build)
const srcAssets = resolve(ROOT, "assets");
if (existsSync(srcAssets)) {
  mkdirSync(resolve(ROOT, "public"), { recursive: true });
  cpSync(srcAssets, resolve(ROOT, "public", "assets"), { recursive: true });
  console.log("  copied assets → public/assets/");
}

console.log("Build complete.");
