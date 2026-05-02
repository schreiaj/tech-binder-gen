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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATES = resolve(ROOT, "templates");

// Register partials
Handlebars.registerPartial(
  "section",
  readFileSync(resolve(TEMPLATES, "section.hbs"), "utf8"),
);

const layout = Handlebars.compile(
  readFileSync(resolve(TEMPLATES, "layout.hbs"), "utf8"),
);

// Load config
const configPath = resolve(ROOT, process.argv.find((a) => a.endsWith(".yaml")) ?? "config.yaml");
if (!existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  console.error("Copy config.example.yaml to config.yaml and edit it.");
  process.exit(1);
}

const config = yaml.load(readFileSync(configPath, "utf8"));

// Pre-process: serialize views (including annotations) to JSON for data attributes
for (const header of config.headers ?? []) {
  for (const section of header.sections ?? []) {
    section.views_json = JSON.stringify(section.views ?? []);
    section.first_view_json = JSON.stringify(section.views?.[0] ?? {});
  }
}

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
