# rexMaps — Build Plan

A personal CalTopo-style mapping app for hiking and trail running. Built as a
multi-stage project; each stage leaves the app deployable and useful. Update the
status column as stages complete, and log notable decisions in the Decision Log.

## Goals & constraints

- **Primary uses:** hiking and trail-running route research, planning, and map making.
  (OnX-Offroad-style features are explicitly out of scope for now — see Backlog.)
- **Budget:** infra + map APIs must stay well under **$50/yr** (the CalTopo
  subscription it replaces). Current architecture is ~$0/mo on Cloudflare free
  tier; the only metered dependency is the Google Map Tiles API (has a monthly
  free tier; all other layers are free/public services).
- **Must-have features (from CalTopo):** sticky snap-to-trail routing, saving
  maps, route research tools, layer opacity + reordering.
- **Platform:** Cloudflare Workers (Next.js via OpenNext adapter), D1 for saved
  maps, R2 later for self-hosted tiles/offline. Auth via Cloudflare Access
  (zero app code).

## Stages

| Stage | Scope | Status |
|-------|-------|--------|
| 0 | Scaffold: Next.js 16 + OpenNext Cloudflare adapter, docs, repo | ✅ done |
| 1 | Map viewer + layer system: MapLibre, layer registry, opacity/reorder/toggle panel, viewport persistence | ✅ done |
| 1b | Google Map Tiles API layers (satellite/roadmap) via session tokens — needs user API key | ✅ done (untested until key added) |
| 2 | Map objects & saved maps: markers/lines/polygons, object list, styles, D1 persistence via API routes, GPX/GeoJSON import/export | ✅ done |
| 3 | Routing: snap-to-trail via BRouter public server (hiking profile), straight-line segment toggle, elevation profile from Terrarium DEM tiles, vertex editing for lines | ✅ done |
| 4 | Route research: terrain stats along line, slope-angle shading layer, place search (Nominatim), Sentinel weekly imagery (NASA GIBS / Copernicus — research needed) | ⬜ next |
| 5 | Deploy: `npm run deploy`, custom domain, Cloudflare Access policy in front | ⬜ |
| 6 | Offline/PWA: service worker, download-map-area to device, R2-hosted PMTiles for cache-friendly sources | ⬜ |
| 7+ | Backlog (below) | ⬜ |

## Stage details & implementation notes

### Stage 2 — Map objects & saved maps (done 2026-08-24)
- Domain model (`src/lib/objects.ts`): `MapObject { id, kind: marker|line|polygon,
  title, color, coords }` — not raw GeoJSON; converted to a FeatureCollection for
  rendering/export. A saved map = `{ objects, stack, viewport }` (`src/lib/savedMaps.ts`).
- D1: `maps(id, title, data, created_at, updated_at)`; migrations in `migrations/`;
  API at `/api/maps` + `/api/maps/[id]` via `getCloudflareContext().env.DB`.
  Local dev D1 shares `.wrangler/state/v3` with `wrangler d1 ... --local`.
- Drawing: **custom tools, no Terra Draw** — Stage 3's snap-to-trail routing needs
  its own click-point/segment state machine anyway, so Terra Draw would have been
  fought, not used. Tools live in the store (`tool`, `draft`) + MapView handlers;
  objects/draft render as data-driven layers (`src/lib/layers/objectLayers.ts`)
  appended by the compositor; edits/selection go through `GeoJSONSource.setData`
  (no style rebuild). Vertex editing deferred to Stage 3.
- GPX/GeoJSON import + export in `src/lib/gpx.ts` (no deps; DOMParser for GPX).

### Stage 3 — Routing (done 2026-08-24)
- The line tool has a **snap toggle** (chip in the draw hint, `s` key, default on).
  Snapped legs route via BRouter (`src/lib/routing.ts`, profile `hiking-mountain`,
  CORS `*` so calls are client-side direct; straight-line fallback on failure;
  swap point for future self-hosted BRouter/Valhalla).
- Lines carry routing topology: `waypoints` (clicked), `legs[i]` (path between
  waypoints i→i+1), `snapped[i]`. `coords` always = concatenated legs.
  `lineTopology()` derives all-straight topology for imports/old lines.
- **Live routing preview** (CalTopo-style): while drawing with snap on, resting
  the cursor ~175 ms routes last-waypoint→cursor and shows it as the dashed
  preview segment (straight dash while the mouse is moving). Debounced with
  abort so ≤1 request is in flight regardless of mouse activity, and results
  land in a 200-entry leg cache shared with commits — clicking a previewed spot
  commits that leg instantly with no second request. `scheduleDraftPreview()` in
  the store; render decision in `draftCursorPath()`.
- **Point undo while drawing**: Backspace/Delete, ⌘/Ctrl+Z, or the ↩ Undo chip
  removes the last placed point + its leg (undoing all points keeps the tool
  armed). A leg undone mid-routing still settles the pending counter.
- Vertex editing: selected objects show drag handles (all kinds). Dragging a
  line waypoint straightens adjacent legs live, then re-routes the snapped ones
  on release (`moveObjectVertex`/`refitObjectVertex`; stale-response guards).
- Elevation profile (`src/lib/elevation.ts`): Terrarium DEM tiles decoded via
  canvas at z13, ~300 samples/line, 3 m hysteresis for gain/loss.
  `ProfilePanel` renders the chart; hovering syncs a marker on the map.
- Not done (backlog): inserting a new waypoint mid-leg by dragging the line
  itself; awaiting in-flight routing before draft finish (a leg finished during
  routing stays straight).

### Stage 4 — Route research
- Slope-angle shading: compute from Terrarium DEM in a worker/canvas, CalTopo
  color ramp (27–29 orange … 45+ purple); render as canvas raster source.
  (Later: precompute PMTiles into R2.)
- Sentinel weekly: needs research. Candidates: NASA GIBS HLS (Harmonized
  Landsat+Sentinel, ~30 m, no key), Copernicus Data Space WMTS (10 m, free
  account + quotas). Pick whichever gives recent-pass browsing without cost.
- Search: Nominatim public API (1 req/s etiquette) + GNIS names later.

### Stage 5 — Deploy
- `npm run deploy` (OpenNext build → Workers). Set the Google key as a build-time
  env (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) and referrer-restrict it in Google
  Cloud console.
- Cloudflare Access: dash → Zero Trust → Access → app for the workers.dev /
  custom domain, allow-list rex's email. No app code.

### Stage 6 — Offline / PWA
- Architected-for: all tile access already goes through the layer registry, so
  an area-downloader can enumerate tiles per layer; add service worker + IndexedDB/
  Cache API storage; respect ToS (Google tiles may NOT be cached/downloaded —
  offline packs use the free/self-hosted layers only).

## Backlog / ideas
- Classic scanned FSTopo quads: self-host from USFS FSGeodata GeoTIFFs → PMTiles in R2.
- MVUM (motor-vehicle use maps) + public land ownership (PAD-US/BLM) layers — the OnX Offroad direction.
- Weather overlays (NOAA forecast grids), snow depth (SNODAS).
- Map sharing / multi-user, live location sharing.
- Printing to PDF at scale.
- 3D terrain view (MapLibre terrain + Terrarium DEM).

## Decision log
- **2026-08-24** Platform: Cloudflare Workers + OpenNext (user pref #1; free tier covers personal use). Scaffolded with create-next-app directly because C3's framework flow now insists on an interactive vinext/OpenNext prompt; OpenNext chosen deliberately (mature, well-documented).
- **2026-08-24** Imagery: user chose **Google Map Tiles API** (paid, keyed, referrer-restricted client key) for Google satellite/roadmap parity; free layers (Esri World Imagery, USGS) kept alongside so the app works with no key.
- **2026-08-24** Auth: **Cloudflare Access** in front of the deployment; no in-app auth code. Revisit only if the app becomes multi-user.
- **2026-08-24** Offline: deferred but architected-for (registry-driven tile access, PWA-compatible choices).
- **2026-08-24** USFS: legacy `EDW_FSTopo_01` MapServer is dead (404). Using the current **Forest Service Basemap** vector tile service instead; classic quads via self-hosting later.
- **2026-08-24** Vector-layer rule: at most **one vector layer active at a time** (MapLibre has a single glyphs URL per style; merging sprite/glyph namespaces across vector styles isn't worth it yet). Raster layers stack freely.
- **2026-08-24** MapLibre worker is self-hosted (`scripts/copy-maplibre-worker.mjs` → `public/`, postinstall) because Turbopack breaks maplibre's `new Worker(new URL(...))`, which silently disables ALL vector tile loading (rasters keep working — very confusing symptom). `MapView` calls `setWorkerUrl("/maplibre-gl-worker.mjs")`; the worker also needs its sibling `maplibre-gl-shared.mjs` copied alongside.
- **2026-08-24** Stage 1 verified end-to-end via headless Chrome/CDP: liberty+hillshade, USFS vector basemap, and Google Satellite (user's key) all render at Mount Hood.
- **2026-08-24** Stage 2: chose custom drawing tools over Terra Draw (Stage 3 snap-routing needs a custom draw machine regardless). Objects render data-driven from two GeoJSON sources the compositor always appends; interaction fast path is `setData`, never a style rebuild. Verified via CDP: draw line/marker/polygon, save→D1, cold-start load (viewport jump), GPX import through the real file input, full CRUD on /api/maps.
- **2026-08-24** Remote D1 created (`e3b6d9cf-4dde-4a9b-91a2-e49c6418006d`, WNAM) and migrated after user re-authed wrangler; wrangler.jsonc carries the real id. Deploy-ready.
- **2026-08-24** Stage 3: BRouter public server chosen (profile `hiking-mountain`; `Access-Control-Allow-Origin: *` verified, so no proxy route — keeps requests off the Worker and preserves the offline-stage architecture). Terrarium DEM also CORS `*`, sampled client-side. Verified via CDP at Timberline: 3 clicks → 253-coord trail-following line; waypoint drag re-routed both adjacent legs; profile chart rendered with sane gain/loss.
- **2026-08-24** Hydration mismatch reported by user (`data-js-focus-visible` injected into `<html>` by a browser extension): fixed with `suppressHydrationWarning` on the `<html>` element only.
- **2026-08-24** Live snap preview added at user request. Load on brouter.de kept polite: 250 ms debounce + AbortController + shared leg cache (commits reuse preview results, so previews usually *reduce* total requests). Verified: 251-point routed preview at rest; instant cached commit on click.
