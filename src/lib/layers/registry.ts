import type { LayerDef } from "./types";

/**
 * Catalog of every layer the app can display. Endpoints, terms, and cost notes
 * are documented in docs/LAYERS.md — keep the two in sync.
 */
export const LAYER_DEFS: LayerDef[] = [
  {
    id: "ofm-liberty",
    kind: "vector-style",
    name: "Street / Topo (OpenFreeMap)",
    description: "OSM vector base map, free and unlimited",
    category: "base",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  },
  {
    id: "google-satellite",
    kind: "raster",
    name: "Google Satellite",
    description: "Google imagery via Map Tiles API (needs API key)",
    category: "base",
    tiles: "google-session",
    googleMapType: "satellite",
    attribution: "© Google",
    maxzoom: 22,
  },
  {
    id: "google-roadmap",
    kind: "raster",
    name: "Google Maps",
    description: "Google road map via Map Tiles API (needs API key)",
    category: "base",
    tiles: "google-session",
    googleMapType: "roadmap",
    attribution: "© Google",
    maxzoom: 22,
  },
  {
    id: "esri-imagery",
    kind: "raster",
    name: "Satellite (Esri World Imagery)",
    description: "High-res imagery, free with attribution",
    category: "base",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution:
      "© Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxzoom: 19,
  },
  {
    id: "tracestrack-topo",
    kind: "raster",
    name: "Tracestrack Topo",
    description: "OSM-derived topo with terrain shading (needs API key)",
    category: "base",
    tiles: "tracestrack",
    attribution: "© Tracestrack, OSM, NASA",
    maxzoom: 19,
  },
  {
    id: "usgs-topo",
    kind: "raster",
    name: "USGS Topo",
    description: "USGS National Map topographic",
    category: "base",
    tiles: [
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "USGS The National Map",
    maxzoom: 16,
  },
  {
    id: "usgs-imagery",
    kind: "raster",
    name: "USGS Imagery",
    description: "USGS National Map aerial imagery (NAIP)",
    category: "base",
    tiles: [
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "USGS The National Map",
    maxzoom: 16,
  },
  {
    id: "usfs-basemap",
    kind: "esri-vector",
    name: "USFS Forest Service Basemap",
    description: "Official Forest Service base map (modern FSTopo)",
    category: "base",
    styleUrl:
      "https://tiles.arcgis.com/tiles/gGHDlz6USftL5Pau/arcgis/rest/services/FSBasemap_20240617/VectorTileServer/resources/styles/root.json",
    attribution: "USDA Forest Service",
  },
  {
    id: "sentinel-s2",
    kind: "raster",
    name: "Sentinel-2 Recent",
    description:
      "Latest Sentinel-2 pass via Copernicus Data Space (needs instance ID)",
    category: "base",
    tiles: "sentinel-cdse",
    attribution: "Contains modified Copernicus Sentinel data",
    // 512px tile z13 → WMTS matrix 14 ≈ Sentinel-2's native 10 m; overzoom above.
    maxzoom: 13,
  },
  {
    id: "slope-angle",
    kind: "raster",
    name: "Slope Angle Shading",
    description:
      "27°+ slope bands computed from Terrarium DEM (avalanche-style ramp)",
    category: "overlay",
    tiles: ["slope://terrarium/{z}/{x}/{y}"],
    attribution: "Slope: Mapzen Terrarium DEM",
    minzoom: 10,
    maxzoom: 14,
    defaultOpacity: 0.7,
  },
  {
    id: "esri-hillshade",
    kind: "raster",
    name: "Shaded Relief",
    description: "Esri World Hillshade — stack over a base at partial opacity",
    category: "overlay",
    tiles: [
      "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "© Esri",
    maxzoom: 16,
  },
];

export const layerDef = (id: string): LayerDef | undefined =>
  LAYER_DEFS.find((d) => d.id === id);
