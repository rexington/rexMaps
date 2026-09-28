/**
 * Tracestrack Topo raster tiles — an OSM-derived topo style with terrain
 * shading (github.com/tracestrack/tracestrack-topo-map). Requires a
 * per-account API key: free for non-commercial use per Tracestrack's own
 * terms, metered plans above that (see docs/LAYERS.md). Like the Google
 * Maps key, this is a client-exposed key with referrer-restriction as its
 * only protection, not a real secret.
 */
export function tracestrackKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TRACESTRACK_KEY || undefined;
}

/** Tile URL template, or undefined with no key. Shared by the compositor and
 * the offline-pack downloader so both request (and cache) identical URLs. */
export function tracestrackTileUrl(): string | undefined {
  const key = tracestrackKey();
  return key ? `https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key=${key}` : undefined;
}
