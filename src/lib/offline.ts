import { ELEVATION_Z, terrariumTileUrl } from "./elevation";
import { getFragment } from "./layers/fragments";
import { layerDef, LAYER_DEFS } from "./layers/registry";
import type { LayerDef } from "./layers/types";

/**
 * "Download this area for offline": enumerates every tile URL a set of
 * layers would need over a bbox/zoom range, fetches them, and stores them in
 * the same Cache Storage bucket the service worker reads from (rexmaps-tiles-v1)
 * — so once a pack is downloaded, ordinary map panning inside it is a cache
 * hit whether or not the device is actually offline. See docs/PLAN.md Stage 6b
 * for the full design rationale.
 */

export const TILE_CACHE = "rexmaps-tiles-v1";

// Google (ToS forbids caching), Sentinel (its tile URLs embed today's date —
// a cached pack would request URLs the live app never asks for again), and
// Tracestrack (caching/redistribution terms not yet confirmed — see
// layerAssets() below) are structurally excluded, not just unchecked by
// default.
export function offlineEligibleLayers(): LayerDef[] {
  return LAYER_DEFS.filter(
    (d) =>
      !(
        d.kind === "raster" &&
        (d.tiles === "google-session" || d.tiles === "sentinel-cdse" || d.tiles === "tracestrack")
      ),
  );
}

type Bbox = [number, number, number, number]; // [west, south, east, north]

function lngLatToTile(lng: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
  const max = n - 1;
  return { x: Math.min(max, Math.max(0, x)), y: Math.min(max, Math.max(0, y)) };
}

/** Tile x/y range covering a bbox at zoom z, padded by `apron` tiles per side. */
function tileRange(bbox: Bbox, z: number, apron = 0) {
  const [w, s, e, n] = bbox;
  const nw = lngLatToTile(w, n, z);
  const se = lngLatToTile(e, s, z);
  const max = 2 ** z - 1;
  return {
    xMin: Math.max(0, nw.x - apron),
    xMax: Math.min(max, se.x + apron),
    yMin: Math.max(0, nw.y - apron),
    yMax: Math.min(max, se.y + apron),
  };
}

function tileCount(bbox: Bbox, z: number, apron = 0): number {
  const r = tileRange(bbox, z, apron);
  return (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
}

function fillTemplate(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

interface TileTemplate {
  template: string;
  /** Zoom bounds the *source* actually covers — e.g. OpenFreeMap's Natural
   * Earth shaded-relief overlay tops out around z6; blindly requesting z14
   * 404s for every tile (found by testing, not assumed). Cap enumeration to
   * this range; MapLibre already overzooms a cached maxzoom tile for deeper
   * live views, so there's no coverage lost by not requesting past it. */
  minzoom: number;
  maxzoom: number;
}

interface LayerAssets {
  /** Every tiled source the layer needs. */
  tileTemplates: TileTemplate[];
  /** Fixed (non-tiled) URLs: sprite json/png, style/TileJSON metadata. */
  staticUrls: string[];
  /** Glyph {fontstack}/{range}.pbf templates × the fontstacks actually used. */
  glyphs: { template: string; fontstacks: string[] }[];
}

/** Every tiled + static URL a layer definition needs, resolved fresh (vector
 * layers go through a real fetch — TileJSON/style metadata rotates, e.g.
 * OpenFreeMap's planet build is date-stamped and changes daily). */
async function layerAssets(def: LayerDef): Promise<LayerAssets> {
  if (def.kind === "raster") {
    // google-session/sentinel-cdse: excluded per their own documented terms
    // (no caching / cache-hostile rolling window — see docs/PLAN.md).
    // tracestrack: excluded conservatively — its caching/redistribution
    // terms haven't been confirmed, unlike the other two; revisit if that
    // gets verified.
    const tiles =
      def.tiles === "google-session" || def.tiles === "sentinel-cdse" || def.tiles === "tracestrack"
        ? []
        : def.tiles;
    const minzoom = def.minzoom ?? 0;
    const maxzoom = def.maxzoom ?? 22;
    return {
      tileTemplates: tiles.map((template) => ({ template, minzoom, maxzoom })),
      staticUrls: [],
      glyphs: [],
    };
  }

  // getFragment() itself fetches the style JSON, and for a TileJSON-referenced
  // source (e.g. OpenFreeMap's date-stamped /planet) the TileJSON too. Both
  // land on the same host as the tiles themselves, already in the service
  // worker's cache-first allowlist — that fetch, made right here, is enough
  // to capture that metadata into the pack with no extra code.
  const fragment = await getFragment(def);
  const tileTemplates: TileTemplate[] = [];
  for (const src of Object.values(fragment.sources)) {
    if ("tiles" in src && Array.isArray(src.tiles)) {
      const minzoom = "minzoom" in src && typeof src.minzoom === "number" ? src.minzoom : 0;
      const maxzoom = "maxzoom" in src && typeof src.maxzoom === "number" ? src.maxzoom : 22;
      for (const template of src.tiles) tileTemplates.push({ template, minzoom, maxzoom });
    }
  }

  const staticUrls: string[] = [];
  const spriteEntries =
    typeof fragment.sprite === "string"
      ? [fragment.sprite]
      : Array.isArray(fragment.sprite)
        ? fragment.sprite.map((s) => s.url)
        : [];
  for (const base of spriteEntries) {
    staticUrls.push(`${base}.json`, `${base}.png`, `${base}@2x.json`, `${base}@2x.png`);
  }

  const fontstacks = new Set<string>();
  for (const layer of fragment.layers) {
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    const tf = layout?.["text-font"];
    if (Array.isArray(tf) && tf.every((f) => typeof f === "string")) {
      fontstacks.add((tf as string[]).join(","));
    }
  }
  const glyphs =
    fragment.glyphs && fontstacks.size > 0
      ? [{ template: fragment.glyphs, fontstacks: [...fontstacks] }]
      : [];

  return { tileTemplates, staticUrls, glyphs };
}

// Glyphs are keyed by 256-codepoint ranges; cover basic Latin + Latin
// Extended (0–511) and stop there — full-script coverage isn't worth the
// request count for a hiking map. Non-Latin labels are a known limitation.
const GLYPH_RANGES = ["0-255", "256-511"];

export interface DownloadOptions {
  bbox: Bbox;
  zMin: number;
  zMax: number;
  layerIds: string[];
  includeTerrain: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface DownloadResult {
  tileCount: number;
  byteSize: number;
}

/** Tile-count-only estimate (no image fetches — layer metadata fetches are
 * cheap and needed for an honest vector-layer count, since a style can bring
 * more than one tiled source). */
export async function estimateDownload(
  opts: Omit<DownloadOptions, "signal" | "onProgress">,
): Promise<{ tiles: number; approxMB: number }> {
  let tiles = 0;
  for (const id of opts.layerIds) {
    const def = layerDef(id);
    if (!def) continue;
    const assets = await layerAssets(def);
    for (const t of assets.tileTemplates) {
      const lo = Math.max(opts.zMin, t.minzoom);
      const hi = Math.min(opts.zMax, t.maxzoom);
      for (let z = lo; z <= hi; z++) tiles += tileCount(opts.bbox, z);
    }
  }
  if (opts.includeTerrain) tiles += tileCount(opts.bbox, ELEVATION_Z, 1);
  // Rough per-tile size — measured ~25-55 KB/tile in practice depending on
  // mix (vector pbf + glyphs/sprite skew small samples up; DEM tiles are
  // smaller). This is a heads-up estimate, not a byte-accurate quote.
  const approxMB = (tiles * 25_000) / (1024 * 1024);
  return { tiles, approxMB };
}

async function canaryOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok && res.type !== "opaque";
  } catch {
    return false;
  }
}

/** Small concurrency-limited task pool. */
async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

export async function downloadArea(opts: DownloadOptions): Promise<DownloadResult> {
  const { bbox, zMin, zMax, layerIds, includeTerrain, signal, onProgress } = opts;

  try {
    await navigator.storage?.persist?.();
  } catch {
    // best-effort — a denied persist() just means normal eviction rules apply
  }

  // Build the full URL list.
  const urls = new Set<string>();
  const canaryHosts = new Set<string>();
  for (const id of layerIds) {
    const def = layerDef(id);
    if (!def) continue;
    const assets = await layerAssets(def);
    for (const url of assets.staticUrls) urls.add(url);
    for (const { template, minzoom, maxzoom } of assets.tileTemplates) {
      canaryHosts.add(new URL(fillTemplate(template, 0, 0, 0)).host);
      const lo = Math.max(zMin, minzoom);
      const hi = Math.min(zMax, maxzoom);
      for (let z = lo; z <= hi; z++) {
        const r = tileRange(bbox, z);
        for (let x = r.xMin; x <= r.xMax; x++) {
          for (let y = r.yMin; y <= r.yMax; y++) urls.add(fillTemplate(template, z, x, y));
        }
      }
    }
    for (const { template, fontstacks } of assets.glyphs) {
      for (const fontstack of fontstacks) {
        for (const range of GLYPH_RANGES) {
          urls.add(template.replace("{fontstack}", fontstack).replace("{range}", range));
        }
      }
    }
  }
  if (includeTerrain) {
    canaryHosts.add(new URL(terrariumTileUrl(0, 0, 0)).host);
    const r = tileRange(bbox, ELEVATION_Z, 1);
    for (let x = r.xMin; x <= r.xMax; x++) {
      for (let y = r.yMin; y <= r.yMax; y++) urls.add(terrariumTileUrl(ELEVATION_Z, x, y));
    }
  }

  // Canary check: one request per distinct host, before the bulk loop —
  // a host lacking CORS fails silently deep into a fetch loop otherwise.
  for (const host of canaryHosts) {
    const sample = [...urls].find((u) => new URL(u).host === host);
    if (sample && !(await canaryOk(sample))) {
      throw new Error(`${host} didn't respond with a cacheable (CORS) response — skipped`);
    }
  }

  const cache = await caches.open(TILE_CACHE);
  const list = [...urls];
  let done = 0;
  let stored = 0;
  let byteSize = 0;

  await runPool(list, 6, async (url) => {
    if (signal?.aborted) return;
    try {
      const res = await fetch(url, { signal });
      if (res.ok || res.type === "opaque") {
        const len = Number(res.headers.get("content-length"));
        await cache.put(url, res.clone());
        byteSize += Number.isFinite(len) && len > 0 ? len : 15_000;
        stored++;
      }
      // A 404/500 etc. is left uncached and simply doesn't count toward
      // `stored` — one bad tile shouldn't abort the whole pack.
    } catch {
      // Network error/abort — same: skip and move on.
    } finally {
      done++;
      onProgress?.(done, list.length);
    }
  });

  return { tileCount: stored, byteSize };
}

/** Remove every downloaded tile — packs remain in the store as metadata only
 * until the user deletes them there too. Individual pack deletion doesn't
 * reclaim storage (tiles may be shared across overlapping packs); this does. */
export async function clearOfflineTiles(): Promise<void> {
  await caches.delete(TILE_CACHE);
}
