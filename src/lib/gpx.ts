import type { FeatureCollection, Position } from "geojson";
import type { LngLat } from "./geo";
import { newObject, objectGeometry, type MapObject } from "./objects";

/** ---------- Export ---------- */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toGPX(objects: MapObject[]): string {
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="rexMaps" xmlns="http://www.topografix.com/GPX/1/1">`,
  ];
  for (const o of objects) {
    if (o.kind === "marker") {
      const [lng, lat] = o.coords[0];
      parts.push(`  <wpt lat="${lat}" lon="${lng}"><name>${esc(o.title)}</name></wpt>`);
    } else {
      // Polygons export as closed tracks — GPX has no polygon concept.
      const coords = o.kind === "polygon" ? [...o.coords, o.coords[0]] : o.coords;
      parts.push(
        `  <trk><name>${esc(o.title)}</name><trkseg>`,
        ...coords.map(([lng, lat]) => `    <trkpt lat="${lat}" lon="${lng}"/>`),
        `  </trkseg></trk>`,
      );
    }
  }
  parts.push(`</gpx>`);
  return parts.join("\n");
}

export function toGeoJSON(objects: MapObject[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: objects.map((o) => ({
      type: "Feature",
      geometry: objectGeometry(o),
      properties: { title: o.title, color: o.color, kind: o.kind },
    })),
  };
}

/** ---------- Import ---------- */

function parseGPX(text: string, startCount: number): MapObject[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not valid GPX/XML");
  const out: MapObject[] = [];
  let n = startCount;

  const nameOf = (el: Element, fallback: string) =>
    el.querySelector("name")?.textContent?.trim() || fallback;
  const pt = (el: Element): LngLat => [
    Number(el.getAttribute("lon")),
    Number(el.getAttribute("lat")),
  ];

  for (const wpt of doc.querySelectorAll("wpt")) {
    const obj = newObject("marker", [pt(wpt)], n++);
    obj.title = nameOf(wpt, obj.title);
    out.push(obj);
  }
  for (const trk of doc.querySelectorAll("trk")) {
    // Concatenate a track's segments into one line (CalTopo behavior).
    const coords: LngLat[] = [];
    for (const p of trk.querySelectorAll("trkseg > trkpt")) coords.push(pt(p));
    if (coords.length < 2) continue;
    const obj = newObject("line", coords, n++);
    obj.title = nameOf(trk, obj.title);
    out.push(obj);
  }
  for (const rte of doc.querySelectorAll("rte")) {
    const coords: LngLat[] = [...rte.querySelectorAll("rtept")].map(pt);
    if (coords.length < 2) continue;
    const obj = newObject("line", coords, n++);
    obj.title = nameOf(rte, obj.title);
    out.push(obj);
  }
  return out;
}

function parseGeoJSON(text: string, startCount: number): MapObject[] {
  const data = JSON.parse(text) as FeatureCollection;
  if (data.type !== "FeatureCollection") throw new Error("Expected a FeatureCollection");
  const out: MapObject[] = [];
  let n = startCount;
  const toLngLat = (c: Position): LngLat => [c[0], c[1]];

  for (const f of data.features) {
    const props = (f.properties ?? {}) as { title?: string; name?: string; color?: string };
    const geoms = f.geometry?.type === "GeometryCollection" ? f.geometry.geometries : [f.geometry];
    for (const g of geoms) {
      if (!g) continue;
      let obj: MapObject | null = null;
      switch (g.type) {
        case "Point":
          obj = newObject("marker", [toLngLat(g.coordinates)], n);
          break;
        case "MultiPoint":
          for (const c of g.coordinates) out.push(newObject("marker", [toLngLat(c)], n++));
          break;
        case "LineString":
          obj = newObject("line", g.coordinates.map(toLngLat), n);
          break;
        case "MultiLineString":
          for (const line of g.coordinates)
            out.push(newObject("line", line.map(toLngLat), n++));
          break;
        case "Polygon": {
          const ring = g.coordinates[0]?.map(toLngLat) ?? [];
          if (ring.length > 3) obj = newObject("polygon", ring.slice(0, -1), n);
          break;
        }
        case "MultiPolygon":
          for (const poly of g.coordinates) {
            const ring = poly[0]?.map(toLngLat) ?? [];
            if (ring.length > 3) out.push(newObject("polygon", ring.slice(0, -1), n++));
          }
          break;
      }
      if (obj) {
        n++;
        if (props.title || props.name) obj.title = (props.title ?? props.name)!;
        if (typeof props.color === "string" && /^#[0-9a-f]{6}$/i.test(props.color))
          obj.color = props.color;
        out.push(obj);
      }
    }
  }
  return out;
}

/** Parse a GPX or GeoJSON file into map objects. Throws with a friendly message. */
export function parseImport(filename: string, text: string, existingCount: number): MapObject[] {
  const trimmed = text.trimStart();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const objects = looksJson
    ? parseGeoJSON(text, existingCount)
    : parseGPX(text, existingCount);
  if (objects.length === 0)
    throw new Error(`No importable features found in ${filename}`);
  return objects;
}
