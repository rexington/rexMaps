import { addProtocol } from "maplibre-gl";
import { useMapStore } from "@/store/mapStore";

/**
 * Sentinel-2 recent imagery via the Copernicus Data Space Ecosystem (CDSE)
 * Sentinel Hub WMTS. Free "Copernicus General Users" tier: 10k requests +
 * 10k processing units per month — fine for personal use; 512px tiles keep
 * the request count down. The user's OGC configuration instance ID (created
 * in the CDSE Sentinel Hub dashboard) goes in NEXT_PUBLIC_SENTINEL_INSTANCE_ID;
 * it is the only credential OGC requests need. See docs/LAYERS.md.
 */

const SH_WMTS = "https://sh.dataspace.copernicus.eu/ogc/wmts";
const SH_WFS = "https://sh.dataspace.copernicus.eu/ogc/wfs";
const OWS_NS = "http://www.opengis.net/ows/1.1";

export function sentinelInstanceId(): string | null {
  return process.env.NEXT_PUBLIC_SENTINEL_INSTANCE_ID || null;
}

interface SentinelCaps {
  layer: string;
  matrixSet: string;
  tileSize: number;
}

const FALLBACK_CAPS: SentinelCaps = {
  layer: "TRUE-COLOR",
  matrixSet: "PopularWebMercator512",
  tileSize: 512,
};

/**
 * Discover the instance's true-color layer id and best tile matrix set from
 * WMTS GetCapabilities, so the registry entry works with any template the
 * configuration was created from. Cached in localStorage per instance.
 */
async function fetchCaps(id: string): Promise<SentinelCaps> {
  const lsKey = `rexmaps-sentinel-caps:${id}`;
  try {
    const cached = localStorage.getItem(lsKey);
    if (cached) return JSON.parse(cached) as SentinelCaps;
  } catch {
    /* ignore */
  }

  const res = await fetch(`${SH_WMTS}/${id}?SERVICE=WMTS&REQUEST=GetCapabilities`);
  if (!res.ok) throw new Error(`GetCapabilities ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");

  const identifier = (el: Element) =>
    el.getElementsByTagNameNS(OWS_NS, "Identifier")[0]?.textContent ?? "";

  const layerEls = [...xml.getElementsByTagName("Layer")];
  const layerIds = layerEls.map(identifier).filter(Boolean);
  const layer =
    layerIds.find((l) => /TRUE.?COLOR/i.test(l)) ?? layerIds[0] ?? FALLBACK_CAPS.layer;

  const matrixIds = [...xml.getElementsByTagName("TileMatrixSet")]
    .map(identifier)
    .filter(Boolean);
  const matrixSet =
    matrixIds.find((m) => m.includes("512")) ??
    matrixIds.find((m) => m.includes("256")) ??
    matrixIds[0] ??
    FALLBACK_CAPS.matrixSet;

  const caps: SentinelCaps = {
    layer,
    matrixSet,
    tileSize: matrixSet.includes("512") ? 512 : 256,
  };
  try {
    localStorage.setItem(lsKey, JSON.stringify(caps));
  } catch {
    /* ignore */
  }
  return caps;
}

let capsMemo: Promise<SentinelCaps> | null = null;

export interface SentinelOptions {
  /** Lookback window in days (imagery = most recent pass inside it). */
  days: number;
  /** "latest" = newest pass regardless of clouds; "clearest" = least cloudy in window. */
  mode: "latest" | "clearest";
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * WMTS TileMatrix identifiers track the 256px-equivalent *scale*, not the XYZ
 * grid: in PopularWebMercator512, matrix N is a 2^(N-1) grid of 512px tiles
 * (probed from GetCapabilities), while MapLibre requests {z}/{x}/{y} in the
 * 2^z grid. So 512px tiles need TILEMATRIX = z+1 — which a plain URL template
 * can't express. The sentinel:// protocol below does the rewrite.
 */
const matrixOffset = (matrixSet: string) => (matrixSet.includes("512") ? 1 : 0);

/** Register the sentinel:// protocol with MapLibre. Idempotent. */
let registered = false;
export function registerSentinelProtocol() {
  if (registered) return;
  registered = true;
  addProtocol("sentinel", async (params, abort) => {
    const m = /^sentinel:\/\/tile\/(\d+)\/(\d+)\/(\d+)\?(.*)$/.exec(params.url);
    if (!m) throw new Error(`bad sentinel tile url: ${params.url}`);
    const [z, x, y] = [+m[1], +m[2], +m[3]];
    const q = new URLSearchParams(m[4]);
    const url =
      `${SH_WMTS}/${q.get("id")}` +
      `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${encodeURIComponent(q.get("layer") ?? "")}&STYLE=default` +
      `&TILEMATRIXSET=${encodeURIComponent(q.get("ms") ?? "")}` +
      `&TILEMATRIX=${z + Number(q.get("off") ?? 0)}&TILEROW=${y}&TILECOL=${x}` +
      `&FORMAT=image/jpeg&TIME=${q.get("time")}&PRIORITY=${q.get("prio")}&MAXCC=100`;
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`sentinel tile ${res.status}`);
    return { data: await res.arrayBuffer() };
  });
}

export interface SentinelScene {
  /** Acquisition date, YYYY-MM-DD (UTC). */
  date: string;
  /** Best (lowest) cloud cover % among the date's granules over the area. */
  cloud: number;
}

/** Cached per rounded-bbox+window so panning nearby costs no extra requests. */
const sceneCache = new Map<string, Promise<SentinelScene[]>>();

/**
 * Sentinel-2 L2A acquisitions covering a bbox within the lookback window,
 * newest first, via the instance's WFS (typename DSS2 = S2 L2A). Drives the
 * "how fresh is this imagery" readout in the layer panel.
 */
export function sentinelScenes(
  bbox: [number, number, number, number], // [w, s, e, n]
  days: number,
): Promise<SentinelScene[]> {
  const id = sentinelInstanceId();
  if (!id) return Promise.resolve([]);
  const r = (n: number) => n.toFixed(1); // ~11 km grid; scenes are ~110 km wide
  const key = `${r(bbox[0])},${r(bbox[1])},${r(bbox[2])},${r(bbox[3])}|${days}`;
  let p = sceneCache.get(key);
  if (!p) {
    p = (async () => {
      const now = Date.now();
      const url =
        `${SH_WFS}/${id}?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0` +
        `&TYPENAMES=DSS2&SRSNAME=EPSG:4326&OUTPUTFORMAT=application/json&COUNT=50` +
        // WFS 2.0 EPSG:4326 axis order: lat first.
        `&BBOX=${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}` +
        `&TIME=${isoDay(now - days * 86400_000)}/${isoDay(now)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`WFS ${res.status}`);
      const fc = (await res.json()) as {
        features: { properties: { date: string; cloudCoverPercentage: number } }[];
      };
      const byDate = new Map<string, number>();
      for (const f of fc.features) {
        const { date, cloudCoverPercentage: cc } = f.properties;
        if (!date) continue;
        byDate.set(date, Math.min(byDate.get(date) ?? 100, cc ?? 100));
      }
      return [...byDate.entries()]
        .map(([date, cloud]) => ({ date, cloud }))
        .sort((a, b) => b.date.localeCompare(a.date));
    })();
    p.catch(() => sceneCache.delete(key)); // don't cache failures
    if (sceneCache.size >= 30) {
      const oldest = sceneCache.keys().next().value;
      if (oldest !== undefined) sceneCache.delete(oldest);
    }
    sceneCache.set(key, p);
  }
  return p;
}

/** Tile URLs + tile size for the Sentinel layer, or null when no instance ID is set. */
export async function sentinelSource(): Promise<{
  tiles: string[];
  tileSize: number;
} | null> {
  const id = sentinelInstanceId();
  if (!id) return null;
  capsMemo ??= fetchCaps(id).catch((err) => {
    capsMemo = null; // allow a retry on the next style rebuild
    console.warn("Sentinel GetCapabilities failed; using defaults", err);
    return FALLBACK_CAPS;
  });
  const caps = await capsMemo;

  const { days, mode } = useMapStore.getState().sentinel;
  const now = Date.now();
  const q = new URLSearchParams({
    id,
    layer: caps.layer,
    ms: caps.matrixSet,
    off: String(matrixOffset(caps.matrixSet)),
    time: `${isoDay(now - days * 86400_000)}/${isoDay(now)}`,
    prio: mode === "clearest" ? "leastCC" : "mostRecent",
  });
  return {
    tiles: [`sentinel://tile/{z}/{x}/{y}?${q}`],
    tileSize: caps.tileSize,
  };
}
