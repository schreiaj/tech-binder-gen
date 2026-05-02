#!/usr/bin/env node
/**
 * Decimate a GLTF/GLB for web distribution using gltfpack.
 * Requires gltfpack on PATH: https://github.com/zeux/meshoptimizer
 *
 * Usage:
 *   node scripts/decimate_gltf.js robot.gltf
 *   node scripts/decimate_gltf.js robot.gltf -o assets/models/robot.glb
 *   node scripts/decimate_gltf.js robot.gltf -s 0.6
 */
import { execFileSync } from "child_process";
import { existsSync, statSync } from "fs";
import { resolve, basename, extname } from "path";

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help") {
  console.log(
    "Usage: node scripts/decimate_gltf.js <input> [-o output] [-s simplification]",
  );
  process.exit(args.length === 0 ? 1 : 0);
}

let input = null;
let output = null;
let simplification = "0.4";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" || args[i] === "--output") {
    output = args[++i];
  } else if (args[i] === "-s" || args[i] === "--simplification") {
    simplification = args[++i];
  } else if (!input) {
    input = args[i];
  }
}

if (!input) {
  console.error("Error: no input file specified.");
  process.exit(1);
}

const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

if (!output) {
  const ext = extname(inputPath);
  const stem = basename(inputPath, ext);
  output = resolve(inputPath, "..", stem + "-web.glb");
}

const cmd = [
  "gltfpack",
  "-i", inputPath,
  "-o", output,
  "-si", simplification,
  "-km", // keep materials
  "-kn", // keep normals
];

console.log(`Running: ${cmd.join(" ")}`);
try {
  execFileSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
} catch {
  process.exit(1);
}

const kb = Math.round(statSync(output).size / 1024);
console.log(`Done: ${output} (${kb} KB)`);
