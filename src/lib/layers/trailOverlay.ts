import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

/**
 * "Possible routes" hint while drawing a snapped line: known OSM paths/
 * tracks/service roads, rendered as a dashed overlay so trails are visible
 * even over bases with no trail data of their own (satellite, or USFS where
 * a particular route isn't mapped). Reuses OpenFreeMap's free vector tiles —
 * the same source ofm-liberty uses — no new paid dependency. Deliberately
 * glyph-free (lines only, no labels), so it can't collide with the app's
 * "one vector layer at a time" rule, which exists only because of the
 * single-glyphs-URL constraint (see AGENTS.md / registry.ts).
 *
 * Gated to MIN_ZOOM on the *source*, not just the layer: CalTopo's equivalent
 * overlay is known to bog the browser when zoomed way out over a huge area
 * with dense trail data. Capping the source's own zoom means MapLibre never
 * requests or parses tiles below that zoom in the first place, rather than
 * fetching them and merely skipping the paint step.
 */

const TRAIL_SOURCE = "rexmaps-trail-overlay";
const PLANET_TILEJSON = "https://tiles.openfreemap.org/planet";
const MIN_ZOOM = 12;
const MAX_ZOOM = 14;

// OpenFreeMap's planet build path is date-stamped and rotates daily —
// resolved fresh via the TileJSON, never hardcoded (same lesson as the
// offline downloader). Cached for the session once resolved.
let tileTemplate: Promise<string> | null = null;

function resolveTileTemplate(): Promise<string> {
  tileTemplate ??= fetch(PLANET_TILEJSON)
    .then((res) => res.json() as Promise<{ tiles: string[] }>)
    .then((json) => json.tiles[0])
    .catch((err: unknown) => {
      tileTemplate = null; // allow a retry on the next request
      throw err;
    });
  return tileTemplate;
}

export async function trailOverlayStyleParts(): Promise<{
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
}> {
  const tiles = [await resolveTileTemplate()];
  return {
    sources: {
      [TRAIL_SOURCE]: { type: "vector", tiles, minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM },
    },
    layers: [
      {
        id: "trail-overlay-line",
        type: "line",
        source: TRAIL_SOURCE,
        "source-layer": "transportation",
        minzoom: MIN_ZOOM,
        // Foot paths, forest/service roads, 4x4 tracks — the way types a
        // hiking route is actually likely to follow. Not an exact match for
        // BRouter's routable graph, just a helpful visual cue.
        filter: ["match", ["get", "class"], ["path", "track", "service"], true, false],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#1e88e5",
          "line-width": 2,
          "line-dasharray": [1, 1.5],
          "line-opacity": 0.55,
        },
      },
    ],
  };
}
