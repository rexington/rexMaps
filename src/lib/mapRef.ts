import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * Shared handle to the live MapLibre map, set by MapView. Panels use it for
 * camera moves (fitBounds/flyTo) only — layer/source mutations stay in the
 * compositor path (see AGENTS.md).
 */
export const mapRef: { current: MaplibreMap | null } = { current: null };
