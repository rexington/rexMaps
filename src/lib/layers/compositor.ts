import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { getFragment } from "./fragments";
import { googleTileUrls } from "./google";
import { EMPTY_FC, objectStyleParts } from "./objectLayers";
import { applyGroupOpacity } from "./opacity";
import { layerDef } from "./registry";
import { sentinelSource } from "./sentinel";
import type { ActiveLayer, RasterLayerDef } from "./types";

/**
 * Builds a complete MapLibre style from the active layer stack (index 0 =
 * bottom). MapView applies the result with `map.setStyle(style, {diff: true})`
 * so successive rebuilds are cheap. This is the ONLY place map layers are
 * assembled — see AGENTS.md architecture invariants.
 */

// Fallback glyphs so our own future symbol layers work even with no vector
// layer active; a vector fragment's glyphs/sprite override these.
const DEFAULT_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

async function rasterEntry(
  def: RasterLayerDef,
  entry: ActiveLayer,
): Promise<{ source: object; layer: object } | null> {
  let tiles: string[] | null;
  let tileSize = def.tileSize ?? 256;
  if (def.tiles === "google-session") {
    tiles = await googleTileUrls(def.googleMapType ?? "satellite");
    if (!tiles) return null; // no API key configured — skip silently
  } else if (def.tiles === "sentinel-cdse") {
    const src = await sentinelSource();
    if (!src) return null; // no instance ID configured — skip silently
    tiles = src.tiles;
    tileSize = src.tileSize;
  } else {
    tiles = def.tiles;
  }
  return {
    source: {
      type: "raster",
      tiles,
      tileSize,
      ...(def.attribution ? { attribution: def.attribution } : {}),
      ...(def.minzoom !== undefined ? { minzoom: def.minzoom } : {}),
      ...(def.maxzoom !== undefined ? { maxzoom: def.maxzoom } : {}),
    },
    layer: {
      id: `${def.id}/raster`,
      type: "raster",
      source: `${def.id}:raster`,
      paint: { "raster-opacity": entry.opacity },
    },
  };
}

export async function buildStyle(
  stack: ActiveLayer[],
  objectsData: FeatureCollection = EMPTY_FC,
  draftData: FeatureCollection = EMPTY_FC,
): Promise<StyleSpecification> {
  const style: StyleSpecification = {
    version: 8,
    glyphs: DEFAULT_GLYPHS,
    sources: {},
    layers: [
      {
        id: "rexmaps-background",
        type: "background",
        paint: { "background-color": "#dde3e8" },
      },
    ],
  };

  for (const entry of stack) {
    if (!entry.visible || entry.opacity === 0) continue;
    const def = layerDef(entry.defId);
    if (!def) continue;

    try {
      if (def.kind === "raster") {
        const built = await rasterEntry(def, entry);
        if (!built) continue;
        style.sources[`${def.id}:raster`] =
          built.source as StyleSpecification["sources"][string];
        style.layers.push(built.layer as StyleSpecification["layers"][number]);
      } else {
        const fragment = await getFragment(def);
        Object.assign(style.sources, fragment.sources);
        for (const layer of fragment.layers) {
          style.layers.push(applyGroupOpacity(layer, entry.opacity));
        }
        if (fragment.sprite) style.sprite = fragment.sprite;
        if (fragment.glyphs) style.glyphs = fragment.glyphs;
      }
    } catch (err) {
      // A broken source shouldn't take down the whole map.
      console.error(`layer ${def.id} failed to build`, err);
    }
  }

  // Drawn objects + in-progress draft always render above every map layer.
  const objects = objectStyleParts(objectsData, draftData);
  Object.assign(style.sources, objects.sources);
  style.layers.push(...objects.layers);

  return style;
}
