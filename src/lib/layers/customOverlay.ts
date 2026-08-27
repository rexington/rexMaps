import type { FeatureCollection } from "geojson";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MaplibreMap,
  SourceSpecification,
} from "maplibre-gl";

/**
 * User-supplied WFS overlays: a generic connector for "someone runs a WFS
 * server with a catalog of places" (the motivating example: SOTA summits),
 * not a specific dataset integration. Bbox-queried per viewport like the
 * Sentinel scene lookup (see sentinel.ts) — never downloaded wholesale, so a
 * dense server can't bog the map the way CalTopo's trail overlay can (see
 * trailOverlay.ts for that lesson applied to tiles instead of features).
 *
 * Deliberately out of scope for v1: Esri FeatureServer support (protocol
 * field left room for it), per-attribute filtering, and offline packs (live
 * queries only — see registry.ts's layerDef(), which these never appear in,
 * so offlineEligibleLayers() excludes them for free). Named Maki-style
 * icons (marker-symbol values like "campsite") are also deferred — unlike a
 * color or a digit/letter badge, an icon needs an actual icon set to render,
 * and CalTopo's own (the obvious reason to want "parity") turns out to be
 * undocumented and can change without notice, so there's no stable public
 * vocabulary to build against yet.
 */
export interface CustomOverlayDef {
  id: string;
  kind: "feature-query";
  protocol: "wfs";
  name: string;
  /** Base WFS endpoint, e.g. https://host/geoserver/wfs */
  url: string;
  /** WFS TYPENAMES value. */
  typeName: string;
  color: string;
  /** Feature property to render as a map label; undefined = no labels. */
  labelField?: string;
}

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Last successfully fetched data per overlay. The compositor always seeds a
 * custom overlay's source empty (a plain style spec has no other way to
 * represent "whatever was last fetched") — so a style rebuild triggered by
 * anything unrelated (another layer's opacity, sentinel/trailOverlay state)
 * recreates the source empty too. MapView reapplies this cache right after
 * every rebuild, with no network involved, so the display doesn't blank out
 * until the next real fetch actually runs. */
const lastGoodData = new Map<string, FeatureCollection>();

export function cachedOverlayData(id: string): FeatureCollection | undefined {
  return lastGoodData.get(id);
}

// A cap this codebase has already found necessary once (Esri's own
// maxRecordCount is typically 1000-2000). Rather than trust any given WFS
// server to honor COUNT/resultType=hits — one already didn't, see the
// research behind this feature — we always fetch once and check the actual
// feature count client-side: under the cap renders everything, over it
// renders nothing plus a message, never a silently truncated set.
const MAX_FEATURES = 500;

export function customSourceId(id: string): string {
  return `custom-overlay:${id}`;
}

function wfsUrl(def: CustomOverlayDef, bbox: [number, number, number, number]): string {
  const base = def.url.includes("?") ? `${def.url}&` : `${def.url}?`;
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: def.typeName,
    SRSNAME: "EPSG:4326",
    OUTPUTFORMAT: "application/json",
    COUNT: String(MAX_FEATURES + 1),
    // WFS 2.0 + EPSG:4326 is lat-first, not the GeoJSON lng-first convention
    // (verified against the CDSE WFS already used for Sentinel scenes). The
    // 5-component BBOX=...,CRS form is valid WFS 2.0 KVP per spec, but a real
    // server (this same CDSE one) rejected it outright ("Illegal BBOX
    // format") — SRSNAME alone already disambiguates, so leave it off, same
    // as the working sentinelScenes() query.
    BBOX: `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`,
  });
  return base + params.toString();
}

/**
 * simplestyle-spec's `marker-symbol` numbered/lettered marker convention: a
 * bare digit "0"-"9" or letter "a"-"z" per the actual spec, plus "circle-N"
 * (N up to 2 digits — verified against a real feed with values up to
 * "circle-10", SOTA's max summit point value) since that's the literal form
 * at least one real source in the wild actually emits. Anything else (Maki
 * icon names) isn't a badge at all — see the file-level comment.
 */
function markerBadge(symbol: unknown): string | null {
  if (typeof symbol !== "string") return null;
  if (/^[0-9a-z]$/.test(symbol)) return symbol;
  const m = /^circle-(\d{1,2})$/.exec(symbol);
  return m ? m[1] : null;
}

export async function fetchOverlayFeatures(
  def: CustomOverlayDef,
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<{ data: FeatureCollection } | { error: string }> {
  try {
    const res = await fetch(wfsUrl(def, bbox), { signal });
    if (!res.ok) return { error: `HTTP ${res.status} — check the URL and type name` };
    const data = (await res.json()) as FeatureCollection;
    if (!data || !Array.isArray(data.features)) {
      return { error: "That response wasn't a GeoJSON FeatureCollection" };
    }
    if (data.features.length > MAX_FEATURES) {
      return { error: `${MAX_FEATURES}+ features in view — zoom in to load this source` };
    }
    // Precompute a badge character where marker-symbol carries one, so the
    // style layer just reads a plain property instead of parsing strings in
    // MapLibre's expression DSL (which has no regex).
    for (const f of data.features) {
      const badge = markerBadge(f.properties?.["marker-symbol"]);
      if (badge && f.properties) f.properties.__markerBadge = badge;
    }
    return { data };
  } catch (err) {
    if (signal?.aborted) return { data: EMPTY_FC };
    void err;
    return {
      error:
        "Couldn't load this source. If it opens fine in a browser tab but not here, " +
        "it's likely missing CORS headers — this app has no server-side proxy.",
    };
  }
}

const POINT_TYPES = ["Point", "MultiPoint"];
const LINE_TYPES = ["LineString", "MultiLineString"];
const POLY_TYPES = ["Polygon", "MultiPolygon"];
const isType = (types: string[]): FilterSpecification =>
  ["match", ["geometry-type"], types, true, false] as unknown as FilterSpecification;

/** A feature's own color/opacity, falling back to the overlay's chosen
 * default — the color half of "simplestyle-spec"
 * (github.com/mapbox/simplestyle-spec), a de facto convention some GeoJSON
 * sources (including a real SOTA summits server this was verified against)
 * use to carry per-feature styling right in the properties. */
const styleColor = (prop: string, fallback: string) =>
  ["coalesce", ["get", prop], fallback] as unknown as ExpressionSpecification;
const styleOpacity = (prop: string, fallback: number, overall: number) =>
  ["*", overall, ["coalesce", ["get", prop], fallback]] as unknown as ExpressionSpecification;

/** Empty-seeded source + geometry-type-filtered style layers for one overlay.
 * Feature data itself arrives later via setData (see loadOverlayInto) — never
 * through a style rebuild, same rule as the drawn-objects/draft sources. */
export function customOverlayStyleParts(
  def: CustomOverlayDef,
  opacity: number,
): { sources: Record<string, SourceSpecification>; layers: LayerSpecification[] } {
  const source = customSourceId(def.id);
  const layers: LayerSpecification[] = [
    {
      id: `${source}/fill`,
      type: "fill",
      source,
      filter: isType(POLY_TYPES),
      paint: {
        "fill-color": styleColor("fill", def.color),
        "fill-opacity": styleOpacity("fill-opacity", 0.25, opacity),
      },
    },
    {
      id: `${source}/line`,
      type: "line",
      source,
      filter: ["any", isType(POLY_TYPES), isType(LINE_TYPES)] as unknown as FilterSpecification,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": styleColor("stroke", def.color),
        "line-width": ["coalesce", ["get", "stroke-width"], 2.5] as unknown as ExpressionSpecification,
        "line-opacity": styleOpacity("stroke-opacity", 1, opacity),
      },
    },
    {
      id: `${source}/point`,
      type: "circle",
      source,
      filter: isType(POINT_TYPES),
      paint: {
        "circle-color": styleColor("marker-color", def.color),
        "circle-radius": 7.5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.75,
        "circle-opacity": opacity,
        "circle-stroke-opacity": opacity,
      },
    },
    // Numbered/lettered marker-symbol badge (see markerBadge()), centered on
    // the point itself — independent of the below-marker labelField text.
    {
      id: `${source}/badge`,
      type: "symbol",
      source,
      filter: ["all", isType(POINT_TYPES), ["has", "__markerBadge"]] as unknown as FilterSpecification,
      layout: {
        "text-field": ["get", "__markerBadge"],
        "text-size": 10.5,
        "text-anchor": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0, 0, 0, 0.6)",
        "text-halo-width": 1,
        "text-opacity": opacity,
      },
    },
  ];
  if (def.labelField) {
    layers.push({
      id: `${source}/label`,
      type: "symbol",
      source,
      filter: isType(POINT_TYPES),
      layout: {
        "text-field": ["get", def.labelField],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-optional": true,
      },
      paint: {
        "text-color": "#1f2937",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.2,
        "text-opacity": opacity,
      },
    });
  }
  return { sources: { [source]: { type: "geojson", data: EMPTY_FC } }, layers };
}

/** Fetch + apply one overlay's current-viewport features via setData, and
 * report loading/error state through `setStatus` (surfaced in LayerPanel). */
export async function loadOverlayInto(
  map: MaplibreMap,
  def: CustomOverlayDef,
  bbox: [number, number, number, number],
  signal: AbortSignal | undefined,
  setStatus: (id: string, status: { loading: boolean; error: string | null }) => void,
): Promise<void> {
  setStatus(def.id, { loading: true, error: null });
  const result = await fetchOverlayFeatures(def, bbox, signal);
  if (signal?.aborted) return;
  if ("data" in result) {
    lastGoodData.set(def.id, result.data);
    const src = map.getSource(customSourceId(def.id)) as GeoJSONSource | undefined;
    src?.setData(result.data);
    setStatus(def.id, { loading: false, error: null });
  } else {
    setStatus(def.id, { loading: false, error: result.error });
  }
}
