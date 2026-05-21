#!/usr/bin/env node
/**
 * Generates a PDF "book" from each HTML file in dist/.
 * Each scroll target becomes its own page, with the 3D viewer rendered
 * in the correct camera position behind it. Text stays as vectors.
 *
 * Usage: node scripts/book.js
 */

// Fix TMPDIR before any imports (nix shells can leave stale paths)
import { existsSync as _exists } from "fs";
if (!process.env.TMPDIR || !_exists(process.env.TMPDIR)) {
  process.env.TMPDIR = "/tmp";
}

import { readdirSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { lookup } from "mime-types";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const OUT = resolve(ROOT, "book");

const landscape = process.argv.includes("--landscape");

function serve(dir, port) {
  return new Promise((res) => {
    const server = createServer(async (req, reply) => {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const filePath = resolve(dir, urlPath.replace(/^\//, ""));
      try {
        const data = await readFile(filePath);
        reply.writeHead(200, { "Content-Type": lookup(filePath) || "application/octet-stream" });
        reply.end(data);
      } catch {
        reply.writeHead(404);
        reply.end("Not found");
      }
    });
    server.listen(port, () => res(server));
  });
}

// CSS to flatten layout for single-page PDF capture
const BASE_CSS = `
  .notebook-header, .scroll-hint { display: none !important; }
  html, body {
    height: 100vh !important;
    overflow: hidden !important;
  }
  .notebook-main {
    position: relative !important;
    height: 100vh !important;
    overflow: hidden !important;
    padding-top: 0 !important;
  }
  .scroll-pane {
    position: absolute !important;
    inset: 0 !important;
    overflow: hidden !important;
    scroll-snap-type: none !important;
  }
  /* Make all scroll targets full viewport, stacked */
  .notebook-title-page,
  .notebook-toc,
  .chapter-title-card,
  .notebook-section {
    min-height: 100vh !important;
    height: 100vh !important;
  }
  .section-card {
    opacity: 1 !important;
  }
`;

async function main() {
  mkdirSync(OUT, { recursive: true });

  const htmlFiles = readdirSync(DIST).filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    console.error("No HTML files found in dist/. Run `npm run build` first.");
    process.exit(1);
  }

  const PORT = 9222;
  const server = await serve(DIST, PORT);
  console.log(`Serving dist/ on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({
    headless: "shell",
    args: [
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });

  for (const htmlFile of htmlFiles) {
    const url = `http://localhost:${PORT}/${htmlFile}`;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    console.log(`Loading ${htmlFile}...`);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

    // Wait for the 3D model to finish loading
    console.log("  Waiting for model...");
    await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const viewer = document.getElementById("viewer");
        if (!viewer) return resolve();
        if (viewer.currentModel) return resolve();
        const timeout = setTimeout(() => reject(new Error("Model load timed out")), 30000);
        viewer.addEventListener("model-loaded", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
    });
    console.log("  Model loaded.");

    // Disable camera animations so views settle instantly
    await page.evaluate(() => {
      const viewer = document.getElementById("viewer");
      if (viewer) viewer._skipAnimation = true;
    });

    const title = await page.title();
    const safeName = (title || basename(htmlFile, ".html"))
      .replace(/[^a-zA-Z0-9_\- ]/g, "")
      .replace(/\s+/g, "_");

    // Inject base print styles
    await page.addStyleTag({ content: BASE_CSS });

    // Collect all scroll targets (title page, toc, chapter titles, sections)
    const targets = await page.evaluate(() => {
      const selector = ".notebook-title-page, .notebook-toc, .chapter-title-card, .notebook-section";
      const els = document.querySelectorAll(selector);
      return Array.from(els).map((el) => {
        // Parse setview detail from the data-on-intersect attribute if present
        let viewData = null;
        const intersectAttr = el.getAttribute("data-on-intersect__full__debounce.50ms") || "";
        const match = intersectAttr.match(/CustomEvent\('setview',\{detail:\{(.+?)\}\}\)/);
        if (match) {
          try {
            // The attribute contains JS object literal syntax — wrap in braces and parse
            viewData = JSON.parse(`{${match[1].replace(/'/g, '"')}}`);
          } catch { /* ignore parse errors */ }
        }
        return { id: el.id, viewData };
      });
    });

    console.log(`  Found ${targets.length} scroll targets`);

    const merged = await PDFDocument.create();

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      console.log(`  Rendering page ${i + 1}/${targets.length}...`);

      // Hide all targets except the current one, and dispatch view event
      await page.evaluate(
        ({ index, viewData, sectionId }) => {
          const selector = ".notebook-title-page, .notebook-toc, .chapter-title-card, .notebook-section";
          const els = document.querySelectorAll(selector);
          els.forEach((el, j) => {
            el.style.display = j === index ? "" : "none";
          });

          const viewer = document.getElementById("viewer");
          if (!viewer) return;

          // Dispatch setview if this section has view data
          if (viewData) {
            viewer.dispatchEvent(new CustomEvent("setview", { detail: viewData }));
          }
        },
        { index: i, viewData: target.viewData, sectionId: target.id }
      );

      // Force a render frame then trigger beforeprint for canvas capture + annotation positioning
      await page.evaluate(() => {
        const viewer = document.getElementById("viewer");
        if (viewer?.renderer) {
          viewer.renderer.render(viewer.scene, viewer.camera);
        }
        window.dispatchEvent(new Event("beforeprint"));
      });
      // Small pause to let the render complete
      await new Promise((r) => setTimeout(r, 500));

      const pdfBytes = await page.pdf({
        format: "Letter",
        landscape,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        displayHeaderFooter: false,
        pageRanges: "1",
      });

      const singleDoc = await PDFDocument.load(pdfBytes);
      const [copiedPage] = await merged.copyPages(singleDoc, [0]);
      merged.addPage(copiedPage);
    }

    const outPath = resolve(OUT, `${safeName}.pdf`);
    writeFileSync(outPath, await merged.save());
    console.log(`  → ${outPath}`);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
