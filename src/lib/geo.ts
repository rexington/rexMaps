export type LngLat = [number, number];

const R_EARTH_M = 6371008.8;

/** Great-circle distance between two [lng, lat] points, in meters. */
export function haversine(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(s));
}

/** Total length of a [lng, lat] path in meters. */
export function pathLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/** Meters → "3.42 mi" / "870 ft" (imperial, CalTopo-style). */
export function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  const miles = feet / 5280;
  return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
}

export const metersToFeet = (meters: number): number => Math.round(meters * 3.28084);

const COORDS_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Parses "lat, lng" (or "lat lng") free text. Null if malformed or out of range. */
export function parseLatLng(input: string): LngLat | null {
  const m = COORDS_RE.exec(input);
  if (!m) return null;
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

/** [west, south, east, north] of a set of points, or null when empty. */
export function bounds(coords: LngLat[]): [number, number, number, number] | null {
  if (coords.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}
