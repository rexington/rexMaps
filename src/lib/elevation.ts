import { haversine, pathLength, type LngLat } from "./geo";

/**
 * Elevation sampling from AWS Terrarium DEM tiles (free open data, CORS *).
 * elevation_m = (R*256 + G + B/256) − 32768, per pixel of a 256px tile.
 * Also the future data source for slope shading + 3D terrain (see docs/LAYERS.md).
 */

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const Z = 13; // ~19 m/px at mid latitudes — plenty for trail profiles
const TILE_SIZE = 256;

const tileCache = new Map<string, Promise<ImageData | null>>();

function fetchTile(x: number, y: number): Promise<ImageData | null> {
  const key = `${x}/${y}`;
  let cached = tileCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch(TILE_URL(Z, x, y));
        if (!res.ok) return null;
        const bitmap = await createImageBitmap(await res.blob());
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = TILE_SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
      } catch {
        return null;
      }
    })();
    tileCache.set(key, cached);
  }
  return cached;
}

/** [lng,lat] → global pixel coords at zoom Z (Web Mercator). */
function toPixel([lng, lat]: LngLat): { px: number; py: number } {
  const scale = TILE_SIZE * 2 ** Z;
  const x = ((lng + 180) / 360) * scale;
  const rad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  return { px: x, py: y };
}

async function elevationAt(pt: LngLat): Promise<number | null> {
  const { px, py } = toPixel(pt);
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const img = await fetchTile(tx, ty);
  if (!img) return null;
  const ix = Math.min(TILE_SIZE - 1, Math.floor(px - tx * TILE_SIZE));
  const iy = Math.min(TILE_SIZE - 1, Math.floor(py - ty * TILE_SIZE));
  const i = (iy * TILE_SIZE + ix) * 4;
  const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
  return r * 256 + g + b / 256 - 32768;
}

export interface ProfilePoint {
  /** Cumulative distance from the start, meters. */
  dist: number;
  /** Elevation, meters. */
  ele: number;
  /** Position on the path (for hover markers on the map). */
  pt: LngLat;
}

export interface ElevationProfile {
  points: ProfilePoint[];
  totalDist: number;
  gainM: number;
  lossM: number;
  minEle: number;
  maxEle: number;
  /** Steepest sustained grade (%), measured over ~60–120 m windows. */
  maxGradePct: number;
}

/** Steepest sustained |grade| over windows of 60–120 m (smoothed elevations). */
function maxGrade(points: ProfilePoint[], smooth: number[]): number {
  let max = 0;
  let j = 0;
  for (let i = 1; i < points.length; i++) {
    while (points[i].dist - points[j].dist > 120) j++;
    for (let k = j; k < i; k++) {
      const d = points[i].dist - points[k].dist;
      if (d < 60) break; // closer samples are inside the window minimum
      max = Math.max(max, Math.abs(smooth[i] - smooth[k]) / d);
    }
  }
  return Math.round(max * 100);
}

/** Evenly resample a path, keeping cumulative distances. */
function resample(coords: LngLat[], maxSamples: number): { pt: LngLat; dist: number }[] {
  const total = pathLength(coords);
  if (total === 0 || coords.length < 2) return [{ pt: coords[0], dist: 0 }];
  const step = Math.max(10, total / maxSamples); // ≥10 m between samples
  const out: { pt: LngLat; dist: number }[] = [{ pt: coords[0], dist: 0 }];
  let acc = 0;
  let next = step;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversine(coords[i - 1], coords[i]);
    while (seg > 0 && next <= acc + seg) {
      const t = (next - acc) / seg;
      out.push({
        pt: [
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
        ],
        dist: next,
      });
      next += step;
    }
    acc += seg;
  }
  out.push({ pt: coords[coords.length - 1], dist: total });
  return out;
}

/**
 * Sample elevations along a path. Returns null when no DEM data was readable.
 * Gain/loss use a 3-sample moving average plus a 3 m hysteresis to keep DEM
 * noise from inflating totals.
 */
export async function elevationProfile(
  coords: LngLat[],
): Promise<ElevationProfile | null> {
  const samples = resample(coords, 300);
  const eles = await Promise.all(samples.map((s) => elevationAt(s.pt)));

  const points: ProfilePoint[] = [];
  samples.forEach((s, i) => {
    const ele = eles[i];
    if (ele !== null && ele > -11000) points.push({ dist: s.dist, ele, pt: s.pt });
  });
  if (points.length < 2) return null;

  const smooth = points.map((p, i) => {
    const win = points.slice(Math.max(0, i - 1), i + 2);
    return win.reduce((sum, q) => sum + q.ele, 0) / win.length;
  });
  let gainM = 0;
  let lossM = 0;
  let anchor = smooth[0];
  for (const ele of smooth) {
    const delta = ele - anchor;
    if (delta >= 3) {
      gainM += delta;
      anchor = ele;
    } else if (delta <= -3) {
      lossM += -delta;
      anchor = ele;
    }
  }

  return {
    points,
    totalDist: points[points.length - 1].dist,
    gainM,
    lossM,
    minEle: Math.min(...points.map((p) => p.ele)),
    maxEle: Math.max(...points.map((p) => p.ele)),
    maxGradePct: maxGrade(points, smooth),
  };
}
