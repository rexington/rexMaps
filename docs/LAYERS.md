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

## Active (Stage 4)

| Layer | Kind | Endpoint | Cost / terms |
|-------|------|----------|--------------|
| Slope Angle Shading | computed raster | `slope://terrarium/{z}/{x}/{y}` (MapLibre custom protocol, `src/lib/layers/slope.ts`) ← Terrarium DEM tiles | Free (client-side compute from Terrarium). Discrete CalTopo-style bands: <27° transparent; 27/30/32/35/46/51/60° = yellow/amber/orange/red/purple/blue/black. Native z10–14, overzooms above. Each tile uses the DEM tile + a 1px apron from 8 neighbors (decoded-tile cache makes that ~1 fetch/tile amortized). |
| Sentinel-2 Recent | raster WMTS | `https://sh.dataspace.copernicus.eu/ogc/wmts/{INSTANCE_ID}?…&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&TIME={from}/{to}&PRIORITY=mostRecent\|leastCC&MAXCC=100` | Free CDSE "Copernicus General Users" tier: **10k requests + 10k processing units/month**, 300/min. Instance ID (created in the CDSE Sentinel Hub dashboard Configuration Utility) is the only credential; goes in `NEXT_PUBLIC_SENTINEL_INSTANCE_ID`. Layer + tile matrix set discovered via GetCapabilities (cached in localStorage); 512px tiles preferred to quarter the request count. Attribution: "Contains modified Copernicus Sentinel data". |

## Active data services (not map layers) — Stage 4 additions

| Service | Endpoint | Cost / terms |
|---------|----------|--------------|
| Nominatim search | `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=…` | Free public API. Etiquette: ≤1 req/s, no autocomplete — the app searches only on Enter. OSM attribution shown in the results dropdown. |
| Sentinel scene dates (WFS) | `https://sh.dataspace.copernicus.eu/ogc/wfs/{INSTANCE_ID}?…&TYPENAMES=DSS2&BBOX={s},{w},{n},{e}&TIME={from}/{to}&OUTPUTFORMAT=application/json` | Same instance ID + quota as the WMTS. `DSS2` = Sentinel-2 L2A footprints; features carry `date`, `time`, `cloudCoverPercentage`. WFS 2.0 EPSG:4326 BBOX is **lat-first**. Drives the "Showing: Aug 24 (today) · ~25% clouds" freshness line in the layer panel; cached per ~11 km bbox + window, fetched only while the layer row is present. |

## Active data services (not map layers)

| Service | Endpoint | Cost / terms |
|---------|----------|--------------|
| BRouter routing | `https://brouter.de/brouter?lonlats={lng},{lat}\|{lng},{lat}&profile=hiking-mountain&alternativeidx=0&format=geojson` | Free public instance, no key, CORS `*`. Returns LineString of `[lng,lat,ele]`. Used by `src/lib/routing.ts` (snap-to-trail). Be a good citizen; self-host BRouter/Valhalla if usage ever grows. |
| Terrain DEM (Terrarium) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Free AWS Open Data, CORS `*`. `ele_m = R*256 + G + B/256 − 32768`. Used by `src/lib/elevation.ts` (profiles); future: slope shading, 3D terrain, hillshade. |

## Planned

| Layer | Kind | Endpoint | Notes |
|-------|------|----------|-------|
| Classic FSTopo quads | self-hosted PMTiles in R2 | source GeoTIFFs: USFS FSGeodata Clearinghouse | Backlog. |
| MVUM, PAD-US land ownership | vector | USFS EDW / USGS services | Backlog (OnX-Offroad direction). |

## Rules learned
- Turbopack breaks maplibre-gl's worker bootstrapping → vector sources silently load zero tiles while raster sources work. Fix: self-host `maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` in `public/` (postinstall script) and `setWorkerUrl()`.
- maplibre's stylesheet forces `position: relative` on the map container, overriding same-specificity Tailwind classes like `absolute` — size the container with explicit `h-full w-full`, never via absolute positioning classes.
- ArcGIS cached MapServer tile URLs are `/tile/{z}/{y}/{x}` — **y before x**.
- Only one *vector* layer may be active at a time (single glyphs URL per MapLibre style). Rasters stack freely.
- Google tiles: no server-side proxying/caching; key lives in the client, protected by HTTP-referrer restriction; attribution string legally required.
- Esri vector tile services need URL normalization: source tiles at `{service}/tile/{z}/{y}/{x}.pbf`, sprite at `{service}/resources/sprites/sprite`, glyphs at `{service}/resources/fonts/{fontstack}/{range}.pbf`.
- WMTS TileMatrix identifiers track the 256px-equivalent **scale**, not the XYZ grid: Sentinel Hub's `PopularWebMercator512` matrix `N` is a 2^(N−1) grid of 512px tiles, so MapLibre's `{z}/{x}/{y}` needs `TILEMATRIX = z+1` (a plain URL template can't express that → the `sentinel://` custom protocol rewrites it). Getting this wrong yields silent all-black tiles (the request "succeeds" — it just samples the Arctic Ocean).
