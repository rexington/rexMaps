import type { FeatureCollection } from "geojson";
import type {
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";
import type { LngLat } from "../geo";

/**
 * Drawn map objects + in-progress draft, rendered as the topmost style layers.
 * All styling is data-driven (color/selected feature properties), so selection
 * and edits only need a GeoJSONSource.setData — no style rebuild.
 */

export const OBJECTS_SOURCE = "rexmaps-objects";
export const DRAFT_SOURCE = "rexmaps-draft";

export const EMPTY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const color = ["get", "color"];
const lineWidth = ["get", "width"];
const ifSelected = (yes: unknown, no: unknown) =>
  ["case", ["==", ["get", "selected"], true], yes, no];

export function objectStyleParts(
  objectsData: FeatureCollection,
  draftData: FeatureCollection,
): {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
} {
  const sources: Record<string, SourceSpecification> = {
    [OBJECTS_SOURCE]: { type: "geojson", data: objectsData },
    [DRAFT_SOURCE]: { type: "geojson", data: draftData },
  };

  const layers = [
    {
      id: "obj-polygon-fill",
      type: "fill",
      source: OBJECTS_SOURCE,
      filter: ["==", ["get", "kind"], "polygon"],
      paint: { "fill-color": color, "fill-opacity": ifSelected(0.35, 0.2) },
    },
    {
      id: "obj-polygon-outline",
      type: "line",
      source: OBJECTS_SOURCE,
      filter: ["==", ["get", "kind"], "polygon"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": ifSelected(3.5, 2) },
    },
    {
      id: "obj-line-halo",
      type: "line",
      source: OBJECTS_SOURCE,
      filter: [
        "all",
        ["==", ["get", "kind"], "line"],
        ["==", ["get", "selected"], true],
      ],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["+", lineWidth, 4],
        "line-opacity": 0.9,
      },
    },
    {
      id: "obj-line",
      type: "line",
      source: OBJECTS_SOURCE,
      filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color,
        "line-width": ifSelected(["+", lineWidth, 1], lineWidth),
      },
    },
    {
      id: "obj-marker-halo",
      type: "circle",
      source: OBJECTS_SOURCE,
      filter: [
        "all",
        ["==", ["get", "kind"], "marker"],
        ["==", ["get", "selected"], true],
      ],
      paint: { "circle-radius": 11, "circle-color": "#ffffff", "circle-opacity": 0.9 },
    },
    {
      id: "obj-marker",
      type: "circle",
      source: OBJECTS_SOURCE,
      filter: ["==", ["get", "kind"], "marker"],
      paint: {
        "circle-radius": ifSelected(8, 6.5),
        "circle-color": color,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    // Draft (in-progress drawing): committed path solid, cursor segment dashed.
    {
      id: "draft-committed",
      type: "line",
      source: DRAFT_SOURCE,
      filter: ["==", ["get", "part"], "committed"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#e6194b", "line-width": 3 },
    },
    {
      id: "draft-preview",
      type: "line",
      source: DRAFT_SOURCE,
      filter: ["==", ["get", "part"], "preview"],
      paint: {
        "line-color": "#e6194b",
        "line-width": 2.5,
        "line-dasharray": [2, 2],
        "line-opacity": 0.8,
      },
    },
    {
      id: "draft-vertex",
      type: "circle",
      source: DRAFT_SOURCE,
      filter: ["==", ["get", "part"], "vertex"],
      paint: {
        "circle-radius": 4.5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#e6194b",
        "circle-stroke-width": 2,
      },
    },
    // Drag handles on the selected object's editable vertices (topmost).
    {
      id: "obj-handle",
      type: "circle",
      source: OBJECTS_SOURCE,
      filter: ["==", ["get", "handle"], true],
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#111827",
        "circle-stroke-width": 2,
      },
    },
  ] as LayerSpecification[];

  return { sources, layers };
}

const samePt = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/** The cursor segment of a draft: the live-routed preview when it matches the
 * cursor position, a straight rubber-band otherwise. */
export function draftCursorPath(draft: {
  waypoints: LngLat[];
  cursor: LngLat | null;
  previewLeg?: LngLat[] | null;
  previewFor?: LngLat | null;
}): LngLat[] | null {
  const last = draft.waypoints[draft.waypoints.length - 1];
  if (!draft.cursor || !last) return null;
  if (
    draft.previewLeg &&
    draft.previewFor &&
    samePt(draft.previewFor, draft.cursor)
  ) {
    return draft.previewLeg;
  }
  return [last, draft.cursor];
}

/** GeoJSON for the draft source while drawing a line/polygon. */
export function draftFeatureCollection(
  kind: "line" | "polygon",
  draft: {
    waypoints: LngLat[];
    legs: LngLat[][];
    cursor: LngLat | null;
    previewLeg?: LngLat[] | null;
    previewFor?: LngLat | null;
  },
): FeatureCollection {
  const { waypoints, legs, cursor } = draft;
  const features: FeatureCollection["features"] = [];
  // Committed path: concatenated legs (snapped legs curve along trails).
  const path: LngLat[] = [];
  for (const leg of legs) for (const c of path.length ? leg.slice(1) : leg) path.push(c);
  if (path.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: path },
      properties: { part: "committed" },
    });
  }
  const cursorPath = draftCursorPath(draft);
  if (cursorPath) {
    const preview = [...cursorPath];
    // Polygons also preview the closing edge back to the start.
    if (kind === "polygon" && cursor && waypoints.length >= 2) preview.push(waypoints[0]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: preview },
      properties: { part: "preview" },
    });
  }
  for (const c of waypoints) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: c },
      properties: { part: "vertex" },
    });
  }
  return { type: "FeatureCollection", features };
}
