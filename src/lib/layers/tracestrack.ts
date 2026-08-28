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
