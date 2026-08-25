import type { LayerSpecification } from "maplibre-gl";

/**
 * Per-layer-type paint properties that control overall opacity. Used to apply
 * a group opacity multiplier across all sub-layers of a merged vector style.
 */
const OPACITY_PROPS: Record<string, string[]> = {
  background: ["background-opacity"],
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  raster: ["raster-opacity"],
  circle: ["circle-opacity", "circle-stroke-opacity"],
  "fill-extrusion": ["fill-extrusion-opacity"],
  heatmap: ["heatmap-opacity"],
  // No true opacity prop for hillshade; exaggeration is the closest knob.
  hillshade: ["hillshade-exaggeration"],
};

/** Returns a copy of `layer` with all opacity-ish paint props scaled by `opacity`. */
export function applyGroupOpacity(
  layer: LayerSpecification,
  opacity: number,
): LayerSpecification {
  if (opacity >= 1) return layer;
  const props = OPACITY_PROPS[layer.type];
  if (!props) return layer;

  const paint: Record<string, unknown> = {
    ...(layer as { paint?: Record<string, unknown> }).paint,
  };
  for (const prop of props) {
    const existing = paint[prop];
    if (existing === undefined) {
      paint[prop] = opacity;
    } else if (typeof existing === "number") {
      paint[prop] = existing * opacity;
    } else {
      // Style expression (zoom curves etc.) — wrap it in a multiply.
      paint[prop] = ["*", opacity, existing];
    }
  }
  return { ...layer, paint } as LayerSpecification;
}
