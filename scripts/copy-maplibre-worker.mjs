#!/usr/bin/env node
// maplibre-gl@6 is ESM-only and resolves its Web Worker relative to
// import.meta.url at runtime (dist/maplibre-gl.mjs's defaultWorkerUrl()).
// Turbopack doesn't preserve that as a real http(s) URL, so the worker
// fails to load ("Worker failed to load. Check that the worker URL is
// correct."). The fix is to serve the worker and its sibling shared chunk
// as plain static files and point maplibre-gl at them explicitly via
// setWorkerUrl() (see map-placement-view.tsx) instead of letting it resolve
// its own worker URL.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const targetDir = join(__dirname, "..", "public", "huntry", "maplibre-worker");

// The worker imports the shared chunk via a relative specifier, so both
// files must land in the same directory.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(targetDir, { recursive: true });

for (const file of FILES) {
  await copyFile(join(sourceDir, file), join(targetDir, file));
}
