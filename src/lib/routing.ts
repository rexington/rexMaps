import type { LngLat } from "./geo";

/**
 * Snap-to-trail routing via the public BRouter instance (free, no key,
 * CORS *). Abstraction point for a future self-hosted BRouter/Valhalla —
 * keep the rest of the app talking only to routeLeg().
 * Endpoint documented in docs/LAYERS.md.
 */

const BROUTER = "https://brouter.de/brouter";
export const ROUTING_PROFILE = "hiking-mountain";

interface BRouterResponse {
  features?: {
    geometry?: { type: string; coordinates: [number, number, number?][] };
  }[];
}

/** Route between two points along known paths. Throws when unroutable. */
export async function routeLeg(
  from: LngLat,
  to: LngLat,
  signal?: AbortSignal,
): Promise<LngLat[]> {
  const lonlats = `${from[0]},${from[1]}|${to[0]},${to[1]}`;
  const url = `${BROUTER}?lonlats=${encodeURIComponent(lonlats)}&profile=${ROUTING_PROFILE}&alternativeidx=0&format=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`brouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as BRouterResponse;
  const coords = data.features?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) throw new Error("brouter: empty route");
  // Strip elevation; ensure the leg spans the clicked endpoints exactly.
  const path = coords.map(([lng, lat]) => [lng, lat] as LngLat);
  path[0] = from;
  path[path.length - 1] = to;
  return path;
}
