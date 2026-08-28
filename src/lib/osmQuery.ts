import type { LngLat } from "./geo";

/**
 * "Query features" — same idea as OpenStreetMap.org's own right-click menu
 * item: click a spot, see whatever OSM data is there. Backed by the free
 * public Overpass API (no key, CORS `*`, generous public etiquette limits —
 * ~10k req/day, well beyond anything a single click-driven UI produces) —
 * see docs/LAYERS.md. One request per click, a real server-side timeout, no
 * polling: the same politeness posture already used for Nominatim/BRouter.
 *
 * Two different questions, one request: "what encloses this point" (a
 * national forest, a wilderness area, a county — anything you're standing
 * *inside*) needs Overpass's `is_in` area query, since a small-radius
 * proximity search only matches geometry that passes near the point, not a
 * polygon whose *interior* covers it (verified live: an "around" query at a
 * point deep inside Rocky Mountain National Park returns nothing, while
 * `is_in` correctly returns the park and the wilderness area within it).
 * "What's right here" (a trail, a peak, a POI) is the small-radius query
 * this already had. Both run in the same Overpass script.
 */
export interface OsmElement {
  type: "node" | "way" | "relation" | "area";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmQueryResult {
  /** Areas whose interior contains the point — parks, forests, wilderness,
   * admin boundaries — sorted protected/reserve areas first, then
   * administrative by most-to-least local, then everything else. */
  areas: OsmElement[];
  /** Tagged elements within a small radius of the point, closest first. */
  nearby: OsmElement[];
}

// A click-scale radius for "nearby", not a viewport-scale one. Most nodes
// within it are untagged way/relation geometry (building outline vertices
// etc.), so the raw cap has to be well above the number of *tagged*
// features actually wanted back.
const RADIUS_M = 25;
const RAW_CAP = 200;

// Some enclosing areas (countries, states, timezones) carry hundreds of
// tags — every language's translated name, mostly — that would flood a
// popup meant to answer "what forest is this." Shown in this order when
// present; everything else is dropped, not shown as raw overflow.
const INTERESTING_TAGS = [
  "name",
  "protection_title",
  "protected_area",
  "boundary",
  "leisure",
  "admin_level",
  "place",
  "operator",
  "website",
  "wikipedia",
  "highway",
  "natural",
  "landuse",
  "amenity",
  "shop",
  "tourism",
  "surface",
  "ele",
];

export function curatedTags(tags: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tags) return out;
  for (const k of INTERESTING_TAGS) if (tags[k] !== undefined) out[k] = tags[k];
  return out;
}

/** True if there's anything worth showing at all — an unnamed building
 * whose only tag is e.g. `building=retail` (common, and "building" isn't
 * curated — a bare building type rarely means anything on its own) would
 * otherwise show a heading pulled from that tag's *value* with an empty,
 * confusingly-contradictory "No attributes" table underneath it. */
function hasCuratedTags(e: OsmElement): boolean {
  return Object.keys(curatedTags(e.tags)).length > 0;
}

function distanceM(pt: LngLat, e: OsmElement): number {
  const elat = e.lat ?? e.center?.lat;
  const elon = e.lon ?? e.center?.lon;
  if (elat === undefined || elon === undefined) return Infinity;
  const [lng, lat] = pt;
  const dLat = (elat - lat) * 111_320;
  const dLng = (elon - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Protected/nature areas first (what "query features" is mainly for here),
 * then administrative boundaries county→state→country (higher admin_level
 * = more local), then whatever's left (timezones, informal regions). */
function areaSortKey(e: OsmElement): [number, number] {
  const t = e.tags ?? {};
  if (t.boundary === "protected_area" || t.leisure === "nature_reserve") return [0, 0];
  if (t.boundary === "administrative") return [1, -(Number(t.admin_level) || 0)];
  return [2, 0];
}

export async function queryOsmFeatures(pt: LngLat, signal?: AbortSignal): Promise<OsmQueryResult> {
  const [lng, lat] = pt;
  // Every statement inside a union block needs its own trailing `;`,
  // including the last one before the closing `)` — omitting it is a
  // syntax error, not a silently-tolerated style choice (caught live: the
  // first version of this string dropped it and Overpass 400'd).
  const ql =
    `[out:json][timeout:15];` +
    `(is_in(${lat},${lng});area._;);out tags;` +
    `(node(around:${RADIUS_M},${lat},${lng});` +
    `way(around:${RADIUS_M},${lat},${lng});` +
    `relation(around:${RADIUS_M},${lat},${lng}););` +
    `out tags center ${RAW_CAP};`;
  const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(ql)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = (await res.json()) as { elements: OsmElement[] };

  const areas = data.elements
    .filter((e) => e.type === "area" && hasCuratedTags(e))
    .sort((a, b) => {
      const ka = areaSortKey(a);
      const kb = areaSortKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
  const nearby = data.elements
    .filter((e) => e.type !== "area" && hasCuratedTags(e))
    .sort((a, b) => distanceM(pt, a) - distanceM(pt, b));

  return { areas, nearby };
}
