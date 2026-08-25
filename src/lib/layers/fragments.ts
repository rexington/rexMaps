import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { EsriVectorLayerDef, VectorStyleLayerDef } from "./types";

/**
 * A style "fragment": the sources + layers of one vector layer def, with all
 * ids namespaced by the def id so multiple fragments can coexist in one style.
 */
export interface StyleFragment {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
  sprite?: StyleSpecification["sprite"];
  glyphs?: string;
}

const fragmentCache = new Map<string, Promise<StyleFragment>>();

function prefixFragment(defId: string, style: StyleSpecification): StyleFragment {
  const sources: Record<string, SourceSpecification> = {};
  for (const [name, src] of Object.entries(style.sources ?? {})) {
    sources[`${defId}:${name}`] = src;
  }
  const layers = (style.layers ?? []).map((layer) => {
    const copy = { ...layer, id: `${defId}/${layer.id}` };
    if ("source" in copy && typeof copy.source === "string") {
      copy.source = `${defId}:${copy.source}`;
    }
    return copy as LayerSpecification;
  });
  return { sources, layers, sprite: style.sprite, glyphs: style.glyphs };
}

/** Resolve a possibly-relative URL, preserving {template} braces. */
function resolveUrl(rel: string, base: string): string {
  if (/^https?:\/\//.test(rel)) return rel;
  return new URL(rel, base)
    .toString()
    .replace(/%7B/gi, "{")
    .replace(/%7D/gi, "}");
}

/** Hosted MapLibre style (e.g. OpenFreeMap): fetch and namespace. */
async function fetchVectorStyleFragment(
  def: VectorStyleLayerDef,
): Promise<StyleFragment> {
  const res = await fetch(def.styleUrl);
  if (!res.ok) throw new Error(`style fetch failed ${res.status}: ${def.styleUrl}`);
  const style = (await res.json()) as StyleSpecification;
  return prefixFragment(def.id, style);
}

interface EsriServiceInfo {
  tileInfo?: { lods?: { level: number }[] };
  copyrightText?: string;
}

/**
 * Esri VectorTileServer style (root.json): resolve its relative source/sprite/
 * glyph URLs against the service, then namespace like any other style.
 * Recipe documented in docs/LAYERS.md ("Rules learned").
 */
async function fetchEsriFragment(def: EsriVectorLayerDef): Promise<StyleFragment> {
  const serviceUrl = def.styleUrl.replace(/\/resources\/styles\/.*$/, "");
  const [styleRes, infoRes] = await Promise.all([
    fetch(def.styleUrl),
    fetch(`${serviceUrl}?f=json`),
  ]);
  if (!styleRes.ok) {
    throw new Error(`esri style fetch failed ${styleRes.status}: ${def.styleUrl}`);
  }
  const style = (await styleRes.json()) as StyleSpecification;
  const info: EsriServiceInfo = infoRes.ok ? await infoRes.json() : {};
  const maxzoom = Math.max(...(info.tileInfo?.lods?.map((l) => l.level) ?? [15]));

  for (const src of Object.values(style.sources ?? {})) {
    if (src.type === "vector") {
      delete (src as { url?: string }).url;
      src.tiles = [`${serviceUrl}/tile/{z}/{y}/{x}.pbf`];
      src.maxzoom = maxzoom;
      if (def.attribution ?? info.copyrightText) {
        src.attribution = def.attribution ?? info.copyrightText;
      }
    }
  }
  if (typeof style.sprite === "string") {
    style.sprite = resolveUrl(style.sprite, def.styleUrl);
  }
  if (style.glyphs) style.glyphs = resolveUrl(style.glyphs, def.styleUrl);
  return prefixFragment(def.id, style);
}

export function getFragment(
  def: VectorStyleLayerDef | EsriVectorLayerDef,
): Promise<StyleFragment> {
  let cached = fragmentCache.get(def.id);
  if (!cached) {
    cached =
      def.kind === "esri-vector"
        ? fetchEsriFragment(def)
        : fetchVectorStyleFragment(def);
    // Don't cache failures — allow retry on next rebuild.
    cached.catch(() => fragmentCache.delete(def.id));
    fragmentCache.set(def.id, cached);
  }
  return cached;
}
