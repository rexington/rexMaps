import { addProtocol } from "maplibre-gl";

/**
 * Slope-angle shading, computed client-side from Terrarium DEM tiles and
 * served to MapLibre through a custom `slope://terrarium/{z}/{x}/{y}` protocol.
 * CalTopo-style discrete bands: <27° transparent, then yellow→orange→red→
 * purple→blue→black (avalanche-terrain convention). Colors are fully opaque —
 * the layer's opacity slider controls the blend.
 *
 * Each output tile needs the center DEM tile plus a 1-pixel apron from its 8
 * neighbors (for slope at tile edges); decoded tiles are cached, so the
 * amortized cost is ~1 DEM fetch + decode per rendered tile.
 */

const TERRARIUM = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const SIZE = 256;

// Discrete slope bands: [minDegrees, r, g, b]. Below the first band → transparent.
const BANDS: [number, number, number, number][] = [
  [27, 245, 245, 10],
  [30, 250, 180, 10],
  [32, 248, 124, 8],
  [35, 235, 0, 10],
  [46, 163, 20, 215],
  [51, 40, 60, 240],
  [60, 20, 20, 20],
];

const eleCache = new Map<string, Promise<Float32Array | null>>();
const MAX_CACHE = 96;

/** Decoded elevations (m) for a DEM tile; null off-planet or on fetch failure. */
function elevations(z: number, x: number, y: number): Promise<Float32Array | null> {
  const n = 2 ** z;
  x = ((x % n) + n) % n; // wrap x across the antimeridian
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${x}/${y}`;
  let p = eleCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(TERRARIUM(z, x, y));
        if (!res.ok) return null;
        const bitmap = await createImageBitmap(await res.blob());
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const out = new Float32Array(SIZE * SIZE);
        for (let i = 0; i < out.length; i++) {
          out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        }
        return out;
      } catch {
        return null;
      }
    })();
    if (eleCache.size >= MAX_CACHE) {
      const oldest = eleCache.keys().next().value;
      if (oldest !== undefined) eleCache.delete(oldest);
    }
    eleCache.set(key, p);
  }
  return p;
}

/** (SIZE+2)² elevation grid: the tile plus a 1px apron from its neighbors. */
async function paddedGrid(z: number, x: number, y: number): Promise<Float32Array | null> {
  const [c, l, r, t, b, tl, tr, bl, br] = await Promise.all([
    elevations(z, x, y),
    elevations(z, x - 1, y),
    elevations(z, x + 1, y),
    elevations(z, x, y - 1),
    elevations(z, x, y + 1),
    elevations(z, x - 1, y - 1),
    elevations(z, x + 1, y - 1),
    elevations(z, x - 1, y + 1),
    elevations(z, x + 1, y + 1),
  ]);
  if (!c) return null;

  const P = SIZE + 2;
  const g = new Float32Array(P * P);
  const at = (row: number, col: number) => row * P + col;
  for (let row = 0; row < SIZE; row++) {
    g.set(c.subarray(row * SIZE, (row + 1) * SIZE), at(row + 1, 1));
    // Side aprons; clamp to the center tile's edge where a neighbor is missing.
    g[at(row + 1, 0)] = l ? l[row * SIZE + SIZE - 1] : c[row * SIZE];
    g[at(row + 1, P - 1)] = r ? r[row * SIZE] : c[row * SIZE + SIZE - 1];
  }
  for (let col = 0; col < SIZE; col++) {
    g[at(0, col + 1)] = t ? t[(SIZE - 1) * SIZE + col] : c[col];
    g[at(P - 1, col + 1)] = b ? b[col] : c[(SIZE - 1) * SIZE + col];
  }
  g[at(0, 0)] = tl ? tl[SIZE * SIZE - 1] : c[0];
  g[at(0, P - 1)] = tr ? tr[(SIZE - 1) * SIZE] : c[SIZE - 1];
  g[at(P - 1, 0)] = bl ? bl[SIZE - 1] : c[(SIZE - 1) * SIZE];
  g[at(P - 1, P - 1)] = br ? br[0] : c[SIZE * SIZE - 1];
  return g;
}

async function encodePng(rgba: Uint8ClampedArray<ArrayBuffer>): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("slope tile encode failed");
  return blob.arrayBuffer();
}

let emptyTile: Promise<ArrayBuffer> | null = null;
const transparentTile = () =>
  (emptyTile ??= encodePng(new Uint8ClampedArray(SIZE * SIZE * 4)));

async function slopeTile(z: number, x: number, y: number): Promise<ArrayBuffer> {
  const g = await paddedGrid(z, x, y);
  if (!g) return transparentTile();

  const P = SIZE + 2;
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  const scale = SIZE * 2 ** z;
  for (let row = 0; row < SIZE; row++) {
    // Meters per pixel varies with latitude (Web Mercator).
    const gy = y * SIZE + row + 0.5;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / scale)));
    const mpp = (156543.03392 * Math.cos(lat)) / 2 ** z;
    const inv2m = 1 / (2 * mpp);
    for (let col = 0; col < SIZE; col++) {
      const i = (row + 1) * P + col + 1;
      const dzdx = (g[i + 1] - g[i - 1]) * inv2m;
      const dzdy = (g[i + P] - g[i - P]) * inv2m;
      const deg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
      let band: [number, number, number, number] | null = null;
      for (const bd of BANDS) {
        if (deg >= bd[0]) band = bd;
        else break;
      }
      if (band) {
        const o = (row * SIZE + col) * 4;
        rgba[o] = band[1];
        rgba[o + 1] = band[2];
        rgba[o + 2] = band[3];
        rgba[o + 3] = 255;
      }
    }
  }
  return encodePng(rgba);
}

/** Register the slope:// protocol with MapLibre. Idempotent; call once at startup. */
let registered = false;
export function registerSlopeProtocol() {
  if (registered) return;
  registered = true;
  addProtocol("slope", async (params) => {
    const m = /^slope:\/\/terrarium\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad slope tile url: ${params.url}`);
    return { data: await slopeTile(+m[1], +m[2], +m[3]) };
  });
}
