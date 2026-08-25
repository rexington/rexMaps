# Layer Source Catalog

Every map layer rexMaps uses (or plans to use), with endpoints, terms, and cost.
All endpoints below were probed and working on 2026-08-24. The runtime registry
lives in `src/lib/layers/registry.ts` — keep the two in sync.

## Active (Stage 1)

| Layer | Kind | Endpoint | Cost / terms |
|-------|------|----------|--------------|
| OpenFreeMap Liberty | vector style | `https://tiles.openfreemap.org/styles/liberty` | Free, no key, no limits. OSM attribution. |
| Google Satellite | raster (session) | `POST https://tile.googleapis.com/v1/createSession` (`mapType: satellite`) → `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=…&key=…` | **Metered.** Map Tiles API, monthly free tier. Session token valid ~2 weeks. Requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (referrer-restrict it). Google attribution required. **No caching/offline permitted.** |
| Google Roadmap | raster (session) | same, `mapType: roadmap` | same |
| Esri World Imagery | raster XYZ | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | Free with Esri attribution. |
| USGS Topo | raster XYZ | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}` | Free, public domain, no key. Max native z ≈ 16. |
| USGS Imagery | raster XYZ | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | Free, public domain. |
| USFS Forest Service Basemap | Esri vector tiles | style: `https://tiles.arcgis.com/tiles/gGHDlz6USftL5Pau/arcgis/rest/services/FSBasemap_20240617/VectorTileServer/resources/styles/root.json` | Free, public USFS service. Needs Esri-style → MapLibre normalization (see `src/lib/layers/esri.ts`). This is the modern FSTopo replacement (legacy `EDW_FSTopo_01` MapServer is dead). |
| Shaded Relief (Esri World Hillshade) | raster XYZ | `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}` | Free with Esri attribution. Use as multiply-ish overlay at partial opacity. |

## Active data services (not map layers)

| Service | Endpoint | Cost / terms |
|---------|----------|--------------|
| BRouter routing | `https://brouter.de/brouter?lonlats={lng},{lat}\|{lng},{lat}&profile=hiking-mountain&alternativeidx=0&format=geojson` | Free public instance, no key, CORS `*`. Returns LineString of `[lng,lat,ele]`. Used by `src/lib/routing.ts` (snap-to-trail). Be a good citizen; self-host BRouter/Valhalla if usage ever grows. |
| Terrain DEM (Terrarium) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Free AWS Open Data, CORS `*`. `ele_m = R*256 + G + B/256 − 32768`. Used by `src/lib/elevation.ts` (profiles); future: slope shading, 3D terrain, hillshade. |

## Planned

| Layer | Kind | Endpoint | Notes |
|-------|------|----------|-------|
| Sentinel weekly | raster | TBD — NASA GIBS HLS (`gibs.earthdata.nasa.gov`, no key, ~30 m) vs Copernicus Data Space WMTS (10 m, free account, quota) | Research in Stage 4. |
| Slope angle shading | computed | derived from Terrarium DEM | CalTopo-style fixed color ramp. |
| Classic FSTopo quads | self-hosted PMTiles in R2 | source GeoTIFFs: USFS FSGeodata Clearinghouse | Backlog. |
| MVUM, PAD-US land ownership | vector | USFS EDW / USGS services | Backlog (OnX-Offroad direction). |

## Rules learned
- Turbopack breaks maplibre-gl's worker bootstrapping → vector sources silently load zero tiles while raster sources work. Fix: self-host `maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` in `public/` (postinstall script) and `setWorkerUrl()`.
- maplibre's stylesheet forces `position: relative` on the map container, overriding same-specificity Tailwind classes like `absolute` — size the container with explicit `h-full w-full`, never via absolute positioning classes.
- ArcGIS cached MapServer tile URLs are `/tile/{z}/{y}/{x}` — **y before x**.
- Only one *vector* layer may be active at a time (single glyphs URL per MapLibre style). Rasters stack freely.
- Google tiles: no server-side proxying/caching; key lives in the client, protected by HTTP-referrer restriction; attribution string legally required.
- Esri vector tile services need URL normalization: source tiles at `{service}/tile/{z}/{y}/{x}.pbf`, sprite at `{service}/resources/sprites/sprite`, glyphs at `{service}/resources/fonts/{fontstack}/{range}.pbf`.
