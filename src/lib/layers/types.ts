export type LayerCategory = "base" | "overlay";

interface LayerDefBase {
  id: string;
  name: string;
  description?: string;
  /** Grouping hint for the Add Layer UI; any layer can sit anywhere in the stack. */
  category: LayerCategory;
  attribution?: string;
  minzoom?: number;
  /** Max native zoom; MapLibre overzooms beyond this. */
  maxzoom?: number;
  /** Opacity applied when the layer is added to the stack (default 1). */
  defaultOpacity?: number;
}

export interface RasterLayerDef extends LayerDefBase {
  kind: "raster";
  /** XYZ template URLs, or a token resolved at runtime by the compositor:
   * "google-session" (Map Tiles API) / "sentinel-cdse" (Copernicus WMTS) /
   * "tracestrack" (Tracestrack Topo). */
  tiles: string[] | "google-session" | "sentinel-cdse" | "tracestrack";
  googleMapType?: "satellite" | "roadmap";
  tileSize?: number;
}

/** A hosted MapLibre style (e.g. OpenFreeMap) merged in as a group. */
export interface VectorStyleLayerDef extends LayerDefBase {
  kind: "vector-style";
  styleUrl: string;
}

/** An Esri VectorTileServer style (root.json with relative URLs). */
export interface EsriVectorLayerDef extends LayerDefBase {
  kind: "esri-vector";
  styleUrl: string;
}

export type LayerDef = RasterLayerDef | VectorStyleLayerDef | EsriVectorLayerDef;

export const isVectorKind = (def: LayerDef) =>
  def.kind === "vector-style" || def.kind === "esri-vector";

/** An entry in the user's layer stack. Index 0 = bottom of the stack. */
export interface ActiveLayer {
  defId: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
}
