// Copies MapLibre's worker bundle (plus the shared chunk it imports as
// "./maplibre-gl-shared.mjs") into public/ so we serve it from our origin.
// Turbopack mangles maplibre's `new Worker(new URL(..., import.meta.url))`
// (the dev server returns HTML for the worker URL), which silently kills all
// vector tile loading. MapView calls setWorkerUrl("/maplibre-gl-worker.mjs").
// Runs on postinstall; the copies are gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "node_modules/maplibre-gl/dist");
mkdirSync(join(root, "public"), { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, f), join(root, "public", f));
}
console.log("copied maplibre-gl worker + shared chunk → public/");
