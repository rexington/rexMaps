import type { FeatureCollection, Feature, Geometry } from "geojson";
import { bounds, pathLength, type LngLat } from "./geo";

/**
 * A drawn map object. Domain model kept simpler than raw GeoJSON:
 * marker = one point, line = polyline, polygon = single ring (no closing dup).
 *
 * Lines drawn with the line tool also carry routing topology: the points the
 * user clicked (`waypoints`), the path of each leg between consecutive
 * waypoints (`legs`, endpoints included), and whether each leg was snap-routed
 * (`snapped`) — so vertex edits can re-route only the affected legs. `coords`
 * is always the full render/export geometry (legs concatenated).
 */
export interface MapObject {
  id: string;
  kind: "marker" | "line" | "polygon";
  title: string;
  /** Hex color, from OBJECT_COLORS. */
  color: string;
  coords: LngLat[]; // marker: length 1
  waypoints?: LngLat[];
  legs?: LngLat[][];
  snapped?: boolean[];
  /** Stroke width in px (kind "line"/"polygon"). Undefined = DEFAULT_LINE_WIDTH. */
  width?: number;
  /** Fill/stroke opacity, 0-1, all kinds. Undefined = DEFAULT_OPACITY. */
  opacity?: number;
  /** Marker glyph id from MARKER_ICONS (kind "marker" only). Undefined = DEFAULT_MARKER_ICON. */
  icon?: string;
  /** Marker badge radius in px (kind "marker" only). Undefined = DEFAULT_MARKER_SIZE. */
  size?: number;
}

export interface LineTopology {
  waypoints: LngLat[];
  legs: LngLat[][];
  snapped: boolean[];
}

/** Concatenate legs (each including endpoints) into one path. */
export function legsToCoords(legs: LngLat[][]): LngLat[] {
  const out: LngLat[] = [];
  for (const leg of legs) {
    for (const c of out.length ? leg.slice(1) : leg) out.push(c);
  }
  return out;
}

/**
 * Routing topology of a line, derived for lines that predate routing (or
 * imports): every original vertex becomes a straight-leg waypoint.
 */
export function lineTopology(obj: MapObject): LineTopology {
  if (obj.waypoints && obj.legs && obj.snapped) {
    return { waypoints: obj.waypoints, legs: obj.legs, snapped: obj.snapped };
  }
  const waypoints = obj.coords;
  const legs: LngLat[][] = [];
  for (let i = 1; i < waypoints.length; i++) legs.push([waypoints[i - 1], waypoints[i]]);
  return { waypoints, legs, snapped: legs.map(() => false) };
}

export const OBJECT_COLORS = [
  "#e6194b", // red (default)
  "#f58231", // orange
  "#ffe119", // yellow
  "#3cb44b", // green
  "#4363d8", // blue
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#000000", // black
] as const;

export const DEFAULT_COLOR: string = OBJECT_COLORS[0];

// Base (unselected) stroke width in px (lines + polygon outlines); selected
// objects render 1px wider.
export const DEFAULT_LINE_WIDTH = 4;
export const MIN_LINE_WIDTH = 1;
export const MAX_LINE_WIDTH = 10;

export const DEFAULT_OPACITY = 1;

export const DEFAULT_MARKER_ICON = "dot";
// Base (unselected) marker badge radius in px; selected markers render 1.5px
// larger. Bigger than the old plain-dot default (was 6.5) — a pictographic
// icon needs more pixels to actually read as its glyph, not just a blob.
export const DEFAULT_MARKER_SIZE = 11;
export const MIN_MARKER_SIZE = 6;
export const MAX_MARKER_SIZE = 20;

export function newObject(
  kind: MapObject["kind"],
  coords: LngLat[],
  existingCount: number,
): MapObject {
  const names = { marker: "Marker", line: "Line", polygon: "Polygon" };
  return {
    id: crypto.randomUUID(),
    kind,
    title: `${names[kind]} ${existingCount + 1}`,
    color: DEFAULT_COLOR,
    coords,
    opacity: DEFAULT_OPACITY,
    ...(kind === "line" || kind === "polygon" ? { width: DEFAULT_LINE_WIDTH } : {}),
    ...(kind === "marker" ? { icon: DEFAULT_MARKER_ICON, size: DEFAULT_MARKER_SIZE } : {}),
  };
}

export function objectGeometry(obj: MapObject): Geometry {
  switch (obj.kind) {
    case "marker":
      return { type: "Point", coordinates: obj.coords[0] };
    case "line":
      return { type: "LineString", coordinates: obj.coords };
    case "polygon":
      return { type: "Polygon", coordinates: [[...obj.coords, obj.coords[0]]] };
  }
}

/** Editable vertices of the selected object (waypoints for topology lines). */
export function objectHandles(obj: MapObject): LngLat[] {
  if (obj.kind === "marker") return [obj.coords[0]];
  if (obj.kind === "line") return lineTopology(obj).waypoints;
  return obj.coords;
}

/** GeoJSON for the compositor's objects source; `selected` drives highlight styling. */
export function objectsToFeatureCollection(
  objects: MapObject[],
  selectedId: string | null,
): FeatureCollection {
  const features: Feature[] = objects.map((obj) => ({
    type: "Feature",
    geometry: objectGeometry(obj),
    properties: {
      id: obj.id,
      kind: obj.kind,
      color: obj.color,
      width: obj.width ?? DEFAULT_LINE_WIDTH,
      opacity: obj.opacity ?? DEFAULT_OPACITY,
      icon: obj.icon ?? DEFAULT_MARKER_ICON,
      size: obj.size ?? DEFAULT_MARKER_SIZE,
      selected: obj.id === selectedId,
    },
  }));
  // Drag handles for the selected object's editable vertices.
  const selected = objects.find((o) => o.id === selectedId);
  if (selected) {
    objectHandles(selected).forEach((pt, idx) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: pt },
        properties: { handle: true, id: selected.id, idx },
      });
    });
  }
  return { type: "FeatureCollection", features };
}

export function objectLength(obj: MapObject): number {
  if (obj.kind === "marker") return 0;
  const coords =
    obj.kind === "polygon" ? [...obj.coords, obj.coords[0]] : obj.coords;
  return pathLength(coords);
}

export function objectBounds(obj: MapObject) {
  return bounds(obj.coords);
}
