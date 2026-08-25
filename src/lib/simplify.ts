import type { LngLat } from "./geo";

/** Perpendicular distance (meters) from p to the line through a-b, using a
 * local equirectangular approximation — fine at trail/regional scale, not
 * meant for continental distances. */
function perpendicularDistanceMeters(p: LngLat, a: LngLat, b: LngLat): number {
  const cosLat = Math.cos((a[1] * Math.PI) / 180);
  const toXY = ([lng, lat]: LngLat): [number, number] => [lng * 111320 * cosLat, lat * 110540];
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer-Douglas-Peucker simplification with a tolerance in meters. Always
 * keeps the first/last points; returns the input unchanged below 3 points
 * or a non-positive tolerance.
 */
export function simplifyPath(coords: LngLat[], toleranceMeters: number): LngLat[] {
  if (coords.length < 3 || toleranceMeters <= 0) return coords;

  function rdp(points: LngLat[]): LngLat[] {
    if (points.length < 3) return points;
    const start = points[0];
    const end = points[points.length - 1];
    let maxDist = 0;
    let maxIdx = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = perpendicularDistanceMeters(points[i], start, end);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist <= toleranceMeters) return [start, end];
    const left = rdp(points.slice(0, maxIdx + 1));
    const right = rdp(points.slice(maxIdx));
    return [...left.slice(0, -1), ...right];
  }

  return rdp(coords);
}
