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
| 4 | Route research: terrain stats along line, slope-angle shading layer, place search (Nominatim), Sentinel-2 recent imagery (Copernicus Data Space WMTS) | ✅ done |
| 5 | Deploy: `npm run deploy`, custom domain, Cloudflare Access policy in front | ✅ done |
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
- Line width is adjustable per-object (slider in the selected-object editor,
  1–10 px, `MapObject.width`; default bumped from 3px to **4px** at user
  request — selected lines render 1px wider than their base width, halo stays
  proportional at base+4). Missing `width` on older/imported lines falls back
  to `DEFAULT_LINE_WIDTH` at render time (`objects.ts`), so old saved maps
  don't need a migration. Round-trips through GeoJSON export/import.
- Vertex editing: selected objects show drag handles (all kinds). Dragging a
  line waypoint straightens adjacent legs live, then re-routes the snapped ones
  on release (`moveObjectVertex`/`refitObjectVertex`; stale-response guards).
- Elevation profile (`src/lib/elevation.ts`): Terrarium DEM tiles decoded via
  canvas at z13, ~300 samples/line, 3 m hysteresis for gain/loss.
  `ProfilePanel` renders the chart; hovering syncs a marker on the map.
- Not done (backlog): inserting a new waypoint mid-leg by dragging the line
  itself; awaiting in-flight routing before draft finish (a leg finished during
  routing stays straight).

### Stage 4 — Route research (done 2026-08-24)
- **Slope-angle shading** (`src/lib/layers/slope.ts`): a MapLibre custom
  protocol (`slope://terrarium/{z}/{x}/{y}`) computes tiles client-side from
  Terrarium DEM — central-difference slope with per-row meters/px, discrete
  CalTopo-style bands (<27° transparent → 27 yellow / 30 amber / 32 orange /
  35 red / 46 purple / 51 blue / 60+ black), PNG-encoded via canvas. Each tile
  reads a (256+2)² grid (tile + 1px neighbor apron; decoded-elevation cache
  keeps it ~1 DEM fetch per tile). Registry entry `slope-angle`, native z10–14,
  `defaultOpacity: 0.7`. Registered in MapView at module scope, next to
  `setWorkerUrl` — the protocol is a tile *transport*, so the registry/compositor
  invariant still holds. (Later: precompute PMTiles into R2 for offline.)
- **Sentinel-2 Recent** (`src/lib/layers/sentinel.ts`): chose **Copernicus Data
  Space (CDSE) Sentinel Hub WMTS** over NASA GIBS HLS for 10 m resolution.
  Free "Copernicus General Users" tier: 10k requests + 10k PUs/month (512px
  tiles preferred — quarter the requests). The OGC configuration *instance ID*
  is the only credential (`NEXT_PUBLIC_SENTINEL_INSTANCE_ID`; user creates it
  in the CDSE dashboard Configuration Utility). GetCapabilities discovers the
  true-color layer id + tile matrix set (cached in localStorage per instance).
  Tile URL carries `TIME={from}/{to}` + `PRIORITY=mostRecent|leastCC`; the
  layer row in LayerPanel gets extra controls (7/14/30-day window,
  latest/clearest) stored in `store.sentinel` — changing them triggers a style
  rebuild (MapView effect deps `[stack, sentinel]`). Tiles go through a
  `sentinel://` custom protocol because the 512px matrix set needs
  `TILEMATRIX = z+1` (see LAYERS.md "Rules learned" — wrong matrix = silent
  black tiles). Verified end-to-end with the user's instance at Mount Hood.
  The layer row also shows imagery freshness ("Showing: Aug 24 (today) ·
  ~25% clouds", tooltip lists every pass in the window) from the instance's
  WFS scene footprints (`sentinelScenes()`; per-area cache, 500 ms debounce
  on viewport changes).
- **Search** (`src/components/SearchBox.tsx`): Nominatim, Enter-only (no
  autocomplete, per usage policy), 6 results, fitBounds on the result's
  boundingbox; raw "lat, lng" input flies directly. Lives beside the Toolbar in
  a shared top-center flex container.
- **Terrain stats**: elevation profile now also reports min–max elevation and
  steepest sustained grade (max |Δele|/Δdist over 60–120 m windows of the
  smoothed profile) in the ProfilePanel header.
- Verified via CDP at Mount Hood: slope bands render over liberty (Steel Cliff
  purple/black, ski-area flats transparent); profile header shows
  "5,812–9,637 ft · ≤76% grade" for a straight-leg test line; searching
  "Timberline Lodge Oregon" flew to the lodge. Sentinel awaits the user's
  instance ID (add-button is disabled until set, like the Google layers).

### Stage 5 — Deploy (deployed 2026-08-25; Access policy still open)
- `npm run deploy` (OpenNext build → Workers). NEXT_PUBLIC_* keys
  (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_SENTINEL_INSTANCE_ID`) are
  read from `.env.local` at `next build` time and inlined into the client
  bundle — confirmed present in the built chunk before deploying. No secrets
  step needed since both are already client-exposed by design (referrer/quota
  restricted, not confidentiality-restricted).
- Live at **https://rexmaps.ke6mt.workers.dev** (Cloudflare's default
  `workers.dev` subdomain — no custom domain purchased). Verified with a
  headless load: default CONUS view renders, all Stage 1–4 layers listed, zero
  network/console failures.
- **Cloudflare Access is not yet in front of it** — the wrangler OAuth token
  used this session has no Zero Trust/Access API scope, and it's a
  security-boundary change anyway, so it's a manual dashboard step for Rex
  (see the checklist below) rather than something done via API. Until it's
  configured, the URL is reachable by anyone who has it (not indexed/linked
  anywhere, but not authenticated either) — saved maps in D1 are hiking
  routes, low sensitivity, but this should still be closed promptly.
  Rex added `maps.ke6mt.us` as a custom domain (Workers & Pages → Domains &
  Routes → Add Custom Domain — zone already on Cloudflare, so DNS/TLS were
  automatic) and confirmed it serves the app. **Use worker-level Access, not a
  hostname-scoped Access app** — a feature shipped 2026-08-14 that covers
  every hostname a Worker answers to (custom domain + `workers.dev` + routes +
  previews) from one toggle, no need to separately protect or disable the
  `workers.dev` fallback:
  1. Workers & Pages → `rexmaps` → **Access** tab → **Protect this Worker
     behind Access** → **All traffic** → any starter policy → **Apply
     Access**. This auto-creates a Worker-scoped Access application covering
     both `maps.ke6mt.us` and `rexmaps.ke6mt.workers.dev`.
  2. Zero Trust → Access controls → Applications → find that app → edit the
     policy to Allow, Include → **Emails** → `rex@vokey.org` only (replacing
     the broader starter policy from step 1).
  - **Caveat**: worker-level Access 403s on WebSocket upgrades. Not used
    anywhere today, but the backlog's "live location sharing / multi-user"
    idea would need Durable Objects/WebSockets — if that's ever built, switch
    that one hostname to a classic hostname-scoped Access app instead.
  - **Done 2026-08-25**: Rex enabled worker-level Access, policy = Allow,
    Include → Email domain `vokey.org` (deliberately broader than one email —
    he's fine with other family members reaching it). Covers both
    `maps.ke6mt.us` and `rexmaps.ke6mt.workers.dev`. Adding Google as a second
    identity provider (to invite friends outside the family domain) is
    backlogged — needs a Google Cloud Console OAuth client (works with
    personal Gmail, not just Workspace); friends would be added to the policy
    by individual email via Include → Emails, alongside/instead of the domain
    rule.

### Stage 6 — Offline / PWA
- Architected-for: all tile access already goes through the layer registry, so
  an area-downloader can enumerate tiles per layer; add service worker + IndexedDB/
  Cache API storage; respect ToS (Google tiles may NOT be cached/downloaded —
  offline packs use the free/self-hosted layers only).

## Backlog / ideas
- Per-object opacity (drawn markers/lines/polygons — distinct from the
  existing per-*layer* opacity sliders in LayerPanel). Extend adjustable width
  to polygon outlines and marker size too (line width for the "line" kind
  already shipped in Stage 4 — a slider in the selected-object editor).
- Worker-proxy + R2/Cache tile caching for Sentinel (and other free layers) —
  **only if the app goes multi-user**: quota is per CDSE instance ID, so shared
  users need a shared cache (and it would hide the instance ID). Pointless at
  single-user scale: ~1–2k of the 10k monthly requests used, and the rolling
  TIME window makes recent-imagery tiles cache-hostile. Google tiles are
  excluded regardless (ToS forbids caching/proxying).
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
- **2026-08-25** Stage 5: deployed to `https://rexmaps.ke6mt.workers.dev`. Cloudflare Access deliberately left as a manual dashboard step rather than API-automated — the session's wrangler token has no Access scope, and a change to the auth boundary in front of a live app is exactly the kind of action to leave to the user rather than script.
- **2026-08-25** Custom domain `maps.ke6mt.us` added (Rex's existing zone) and confirmed working. Access plan revised: use **worker-level Access** (Workers & Pages → Access tab → "Protect this Worker behind Access"), a feature that shipped 2026-08-14 — it covers the custom domain *and* the `workers.dev` fallback from one Worker-scoped Access app, so there's no separate "protect two hostnames or disable one" step. Confirmed against current developers.cloudflare.com docs, not prior knowledge (docs had recently moved to `access-controls/applications/http-apps/...`). Caveat recorded: it 403s on WebSocket upgrades, relevant if the backlog's live-location-sharing idea ever ships.
- **2026-08-25** Access configured and live: policy allows the `vokey.org` email domain (not a single address) — deliberate, Rex is fine with family members having access. **Stage 5 complete.** Google as a second IdP (for friends outside the family domain) backlogged, confirmed against current docs: needs a Google Cloud Console OAuth client, works with personal Gmail.
- **2026-08-25** Top bar overlap fix: `ObjectsPanel` and `LayerPanel` were both anchored `top-2` like the centered Toolbar/SearchBox row, so at moderate window widths (confirmed overlapping by ~950px wide with the search box open) the corner panels' expanded content visually collided with the map tools. Fixed by moving both corner panels to `top-14`, clearing the tools row entirely regardless of viewport width, rather than a full flex/grid rewrite of the four independently-absolutely-positioned top overlays. `max-h-[calc(100dvh-Xrem)]` scroll caps adjusted from 5rem to 8rem to preserve the same bottom clearance.
- **2026-08-24** Stage 4: Sentinel imagery via **CDSE Sentinel Hub WMTS** (user created a CDSE account; 10 m beats GIBS HLS's 30 m; free tier 10k req/mo). Slope shading is computed client-side through a MapLibre custom protocol rather than pre-rendered tiles — zero hosting cost, works offline once DEM tiles are cached, and reuses the Terrarium pipeline from elevation profiles. Nominatim search is Enter-only to respect their no-autocomplete policy. Line hit-testing got a ±4 px box (user feedback: thin lines were hard to click); object rename input got an explicit white background (was transparent over the panel).
