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
  maps, R2 later for self-hosted tiles/offline. Auth is in-app (Google OIDC +
  D1 sessions, `src/lib/auth.ts`) as of 2026-08-28 — reversed from the
  original zero-app-code Cloudflare Access plan; see decision log.

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
| 6 | Offline/PWA: service worker, download-map-area to device | ✅ done |
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

**6a — PWA shell (done 2026-08-25).**
- `src/app/manifest.ts` (served at `/manifest.webmanifest`), `app/icon.tsx` +
  `app/apple-icon.tsx` (Next's icon file convention, rendered via `next/og`
  `ImageResponse`) + two extra hand-rolled routes `app/icons/192|512/route.tsx`
  for the manifest's `icons[]`, which needs stable URLs (Next's own `/icon`
  path carries a cache-busting query Next controls, not us). Shared glyph in
  `src/lib/appIcon.tsx`. **Gotcha**: the classic CSS border-triangle trick
  renders as a plain rectangle under Satori (ImageResponse's engine) — no
  triangle, just solid color. Fixed with an inline `<svg><polygon>` instead,
  which Satori does support. Verified all four icon routes render correctly
  under the actual `workerd` runtime (not just Next's own build-time Node
  process) via local `wrangler dev`.
- `public/sw.js`: hand-rolled, no bundler (same reasoning as self-hosting the
  MapLibre worker — a next-pwa-style plugin is another Turbopack-compat risk).
  Two cache namespaces: `rexmaps-shell-v1` (app shell + hashed static assets,
  pruned on version bump) and `rexmaps-tiles-v1` (basemap/terrain tiles,
  **never** pruned by a shell version bump — Stage 6b's downloaded packs live
  here and must survive app updates). Cache-first for a fixed allowlist of
  evergreen tile hosts (OpenFreeMap, arcgisonline.com, USGS, USFS Basemap,
  Terrarium DEM on S3); explicit never-cache for `tile.googleapis.com` (ToS)
  and this app's own `/api/*`; everything else (BRouter, Nominatim, CDSE) left
  untouched. A `KILL_SWITCH` constant, flip + redeploy to remotely unregister
  and wipe all caches — the only recovery path for a bad SW already installed
  on someone's phone.
  - **Critical bug avoided, not yet hit**: Cloudflare Access serves its login
    page via a redirect at the exact same URL as the app when a session has
    lapsed. A naive "network-first, cache the response" navigation handler
    would cache that login page as the app shell, bricking offline use. Fixed:
    only `cache.put()` a navigation response that's same-origin, `!redirected`,
    and `res.ok`; still `return res` (whatever it is) to the browser so normal
    online re-authentication isn't affected — only the *cache write* is
    guarded, not the response the user sees.
  - Verified `/sw.js` serves `Cache-Control: public, max-age=0, must-revalidate`
    (OpenNext/Wrangler's asset default — no extra config needed to avoid
    pinning a stale worker).
- `ServiceWorkerRegister.tsx`: registers only when `NODE_ENV === "production"`
  — an active SW in dev would intercept Turbopack's HMR requests.
- **Verified via CDP against a local `wrangler dev` (real `workerd`, not
  `next dev`)**: one online pageload organically cached 63 tiles; a hard
  navigation reload with the network fully cut (CDP
  `Network.emulateNetworkConditions`) rendered the complete app — toolbar,
  panels, basemap, hillshade — pixel-identical to the online load, from the
  service worker alone. Deployed; confirmed both `maps.ke6mt.us` and the
  `workers.dev` fallback (including `/sw.js` itself) still correctly gated by
  Cloudflare Access post-deploy.

**6b — Download-map-area to device.** All tile access already goes through
the layer registry, so an area-downloader can enumerate tiles per layer.
Scope, decided with advisor input before writing code:
- Cache Storage for tile bytes (not IndexedDB — it's literally what Cache
  Storage is for); pack *metadata* (name, bbox, layers, tile count, size)
  joins the existing zustand-persist localStorage pattern, no new persistence
  tech.
- v1 downloads the **current viewport only** (no separate box-drawing tool —
  pan/zoom first, like most offline-map apps).
- Google **and Sentinel** excluded from the layer picker. Google is ToS (as
  before); Sentinel is structural, not preferential — its tile URLs embed
  `TIME={today}`, so a pack cached today requests URLs the live app will never
  ask for again tomorrow. Guaranteed miss, not merely low-value.
- Terrain (Terrarium DEM) tiles cached at their fixed z13 (`elevation.ts`) with
  a 1-tile bbox apron per zoom (matches `slope.ts`'s 8-neighbor read) makes
  elevation profiles **and** slope-angle shading work offline for free, since
  both hit plain `fetch()` against `s3.amazonaws.com/elevation-tiles-prod/`
  and that host is already in the SW's cache-first allowlist — confirmed
  before writing any download-orchestrator code, not assumed.
- Pre-flight tile-count/size estimate shown before download starts, with a
  refuse-above-threshold guard (tile counts scale as 4^z — an unbounded
  z10→z16 pull across 3 layers is tens of thousands of tiles). Call
  `navigator.storage.persist()` once a download starts; note in the UI that
  iOS Safari evicts storage for tabs not installed to the home screen after
  ~7 days idle.
- OpenFreeMap's vector source resolves through a **daily-rotating TileJSON**
  (`tiles.openfreemap.org/planet` → `.../planet/20260823_080002_pt/{z}/{x}/{y}.pbf`,
  confirmed 2026-08-25) — resolved at download time via the existing
  `getFragment()`, never hardcoded. The SW's host-based (not path-based)
  cache-first rule for `tiles.openfreemap.org` transparently captures that
  TileJSON response too, so a stale pack still resolves offline without any
  extra code.
- Glyphs: don't chase full coverage. Pull the distinct `text-font` values off
  the resolved style fragment's layers, fetch ranges 0–255 and 256–511 per
  font. Non-Latin labels are a known, documented v1 limitation.
- Canary fetch (one tile, checked for `response.type !== "opaque"`) per host
  before the bulk loop — `cache.put()` silently mishandles a response it can't
  verify from a host lacking CORS, better to fail loud on tile 1 than tile 4000.
- "Delete" on a pack removes it from the list only (tiles may be shared with
  other overlapping packs; no per-tile refcounting in v1) — a separate "clear
  all offline data" nukes the whole tile cache. UI copy says this plainly.
- R2-hosted PMTiles pre-baking, originally listed under this stage, is
  **out of scope** for 6b and folded into the existing FSTopo-quads backlog
  item instead — it solves a different problem (hosting a dataset with no
  live tile service at all) than this stage's actual need (on-device caching
  of already-live tile services for one user).

**6b implementation (done 2026-08-25).** `src/lib/offline.ts` (enumeration +
fetch orchestrator), `OfflinePackMeta` in the store (persisted metadata list),
`src/components/OfflineSection.tsx` (a new collapsible section inside
LayerPanel, not a new floating corner — deliberately, to avoid reopening the
overlap problem fixed earlier this stage).
- **Real bug found and fixed via testing, not assumed away**: the first
  end-to-end run enumerated tiles for every source across the *entire*
  requested zoom range regardless of that source's own coverage — OpenFreeMap's
  Natural Earth shaded-relief overlay (`ne2sr`) only exists at low native
  zoom, so requesting it at z12–14 **404'd on 32 of 94 URLs**, silently
  (per-tile failures don't abort the pack). Root-caused via CDP network
  logging, not guessed. Fixed by reading each source's actual `minzoom`/
  `maxzoom` (from the resolved style/TileJSON for vector layers, from the
  registry `LayerDef` for raster) and clamping enumeration to it — which also
  fixed raster `LAYER_DEFS` that were previously ignoring their own declared
  `maxzoom`. No coverage lost: MapLibre already overzooms a cached
  maxzoom tile to cover a deeper live view.
- Also fixed in the same pass: `downloadArea()`'s returned `tileCount` was
  the *attempted* URL count, not the count that actually landed in the
  cache — cosmetically fine until a host has any failures, then the pack
  metadata overstates what's really available offline. Now counts only
  successful `cache.put()`s.
- Verified with two separate CDP scripts: (1) the download UI end-to-end —
  opening the form correctly pre-checks the currently active+visible
  layers, the debounced estimate matches the real run, the pack's
  `tileCount` now exactly equals `caches.open("rexmaps-tiles-v1").keys().length`
  (62 = 62), zero HTTP failures after the zoom-bounds fix; (2) the actual
  payoff — downloaded a pack at z15 (a zoom level + viewport never organically
  browsed in that session), then went fully offline (CDP network emulation)
  and did a hard reload to that exact viewport: the vector basemap, labels,
  and glyphs all rendered correctly from the downloaded pack alone, zero
  failed resource loads.
- Byte-size estimate constant tuned from an assumed 15 KB/tile to 25 KB/tile
  after measuring ~54 KB/tile on a real (small, sprite/glyph-heavy) sample —
  still explicitly a rough heads-up number, not a byte-accurate quote.

### Mobile layout pass (done 2026-08-25)
User feedback after trying it on a phone: the horizontal top-center toolbar
competed with the top corner dropdowns for space, the draw-in-progress hint
didn't fit, and double-click/Enter to finish a line is impractical on touch.
- **Toolbar** (`Toolbar.tsx`) is a vertical stack on the right below the top
  corner buttons (mobile default: `right-2 top-20 flex-col`) and reverts to
  the original horizontal top-center layout at `sm:` (640px) and up — freeing
  `top-2` for the ObjectsPanel/LayerPanel dropdowns on mobile, which no longer
  need the `top-14` offset added earlier this stage (that offset is now
  `sm:top-14`-only, still needed on desktop where the toolbar stays top-center).
- Both dropdowns **default closed** on load (`useState(false)`, was `true`) —
  a general preference, not mobile-specific.
- **DrawHint** repositioned to the bottom on mobile (`bottom-6`, was
  `top-14`), widened and wrapping (`flex-wrap`) instead of a fixed-width
  nowrap pill, reverting to the original top-center pill at `sm:`. Hint text
  dropped "Enter/double-click finishes" (still work, just no longer the
  primary path) in favor of an explicit **✓ Finish** chip — shown once the
  draft has enough points (`draftFinish()` already has identical line/polygon
  logic, so one chip covers both tools, confirmed by testing polygon too).
- **Real bug found via testing, not a screenshot artifact — verify before
  trusting a headless screenshot that disagrees with `getBoundingClientRect()`**:
  the Finish/Undo/Snap chips were computed at correct, fully-in-viewport
  positions (confirmed via direct DOM measurement) but simply didn't render
  in the capture, and `document.elementFromPoint()` at that exact spot
  returned MapLibre's own attribution link instead of our button. Root cause:
  `maplibre-gl.css` sets `.maplibregl-ctrl-{corner}` to `z-index: 2`; our
  overlay `<div>`s had no z-index (`auto`), so MapLibre's own corner controls
  were winning the paint/hit-test order wherever they happened to overlap our
  UI — invisible AND unclickable, not just visually behind. Fixed by giving
  every top-level floating panel (`Toolbar`/`SearchBox` wrapper, `DrawHint`,
  `ObjectsPanel`, `LayerPanel`, `ProfilePanel`) an explicit `z-10`. On the
  right side, additionally reserved a `right-16` gap so the hint doesn't
  physically cover MapLibre's zoom/geolocate buttons at all (z-index makes
  *our* UI win a visual conflict, which is wrong for controls the user still
  needs — avoiding the overlap outright is correct there; z-10 alone is the
  right fix for the non-interactive attribution link on the left).

### Trail overlay while drawing (done 2026-08-25)
User request: while drawing a line with snap on, show a hint of nearby known
trails/tracks — CalTopo has this, but is known to bog the browser badly when
zoomed way out over dense trail data. Also wanted specifically so it's useful
over bases with no trail data of their own (satellite, or USFS where a route
isn't mapped).
- `src/lib/layers/trailOverlay.ts`: a dashed blue line layer sourced from
  OpenFreeMap's free vector tiles (`transportation` source-layer, `class` in
  `path`/`track`/`service` — foot paths, forest/service roads, 4x4 tracks;
  not an exact match for BRouter's routable graph, just a helpful visual
  cue). Deliberately glyph-free (no labels), so it never collides with the
  "one vector layer at a time" rule — that rule exists only because of the
  single-glyphs-URL constraint, and this overlay doesn't need glyphs, so it
  layers over *any* active base (raster or vector) without conflict. Same
  daily-rotating-TileJSON lesson as the offline downloader: the tile
  template is resolved fresh via `fetch`, never hardcoded.
- **Performance guard, the actual point of the request**: `minzoom: 12` is
  set on the vector *source* itself, not just the layer. A layer-only minzoom
  would still let MapLibre fetch and parse tiles at low zoom and merely skip
  painting them — source minzoom means MapLibre never requests those tiles at
  all below that zoom. Verified: zooming from z14 to z6 while still in
  line+snap mode produced **zero** additional `openfreemap` network requests.
- Contextual, not a togglable layer: `compositor.ts`'s `buildStyle()` takes
  an `options.trailOverlay` flag, wired in `MapView.tsx` from
  `tool === "line" && snapEnabled`. Appears only while actually drawing a
  snapped line, disappears the moment you switch tools (verified: the
  `trail-overlay-line` MapLibre layer is fully gone on switching to select) —
  deliberately not a persistent LayerPanel entry, both because the request
  was specifically about the draw workflow and because an always-on trail
  layer is exactly the kind of thing that invites the CalTopo bogging
  problem if someone forgets to turn it off while browsing zoomed out.
- Verified visually at Timberline Lodge over Esri World Imagery (no
  OpenFreeMap layer in the stack at all): the ski area's road/trail network
  renders clearly as a dashed blue overlay directly on the satellite imagery.

### Object opacity/width/icons + line simplification (done 2026-08-25)
Backlog items 1, 3, 4, picked as a batch (next planned: item 7, 3D terrain).

- **Per-object opacity + width/size** (`objects.ts`): `MapObject.opacity` (0-1,
  all kinds), `width` now also applies to polygon outlines (was line-only),
  new `size` for markers (badge radius). All follow the width-field precedent
  from Stage 3: a property with a `DEFAULT_*` constant, missing on
  old/imported objects falls back at render time — no migration needed.
  `objectLayers.ts` multiplies opacity into `fill-opacity` (polygon fill
  already had a selected/unselected alpha; opacity scales that, doesn't
  replace it) and sets `line-opacity`/`icon-opacity` directly elsewhere.
- **Marker icons** (`src/lib/markerIcons.ts`): converts the marker layer from
  a plain `circle` to a `symbol` layer. Icons are drawn client-side with
  Canvas 2D (12 hand-coded glyphs: dot/star/camp/water/parking/summit/
  viewpoint/photo/danger/food/campfire/flag) onto a colored circular badge —
  no icon-font or SVG-sprite dependency. Registered with MapLibre's image
  manager via `map.addImage()`, keyed `marker-icon:{icon}:{color}`; `ensureMarkerIcons()`
  is called from three places in `MapView.tsx` (map init, after every
  `setStyle`, and on any objects-array change) since runtime-added images
  aren't guaranteed to survive a style rebuild and there's no single choke
  point that covers "new marker drawn" + "icon/color edited" + "page just
  loaded from persisted state" otherwise.
  - **Gotcha**: `icon-size` on a symbol layer is a *scale factor* on the
    image's native pixel size, not an absolute radius like `circle-radius`
    was — `ICON_SCALE_DIAMETER` in `markerIcons.ts` is the reference to
    divide into the desired on-screen diameter.
  - **Found via screenshot, fixed via constant tuning**: the first render used
    the old plain-dot default radius (6.5px) and the pictographic icons were
    just illegible blobs at that size — a plain dot doesn't need pixels to
    read, a mountain-peak glyph does. Bumped `DEFAULT_MARKER_SIZE` 6.5→11
    (range 3–14 → 6–20). Old markers (no `size` field) render slightly bigger
    now too — same accepted tradeoff as the Stage 3 line-width default bump.
  - **Found via screenshot, fixed via redraw**: campfire and the water
    droplet read as the same rounded blob at marker size; danger's
    exclamation mark was too thin to see. Gave campfire a crossed-log base
    (the silhouette alone wasn't enough) and bolded danger's stroke/mark.
  - A large chunk of debugging time here was chasing a problem that turned
    out to be in the *test script*, not the app: a 12-marker QA grid only
    showed 6 markers, which looked exactly like a rendering bug. It was
    degrees-per-pixel arithmetic at a given zoom being wrong, positioning
    the other 6 off-canvas — confirmed via `map.project()` on all 12
    coordinates, which showed negative/overflowing screen x. Worth
    remembering: when only *some* of a repeated/generated set of map
    features render, check the test's own coordinate math before suspecting
    the styling code.
- **Line simplification** (`src/lib/simplify.ts`): standard Ramer-Douglas-
  Peucker with a meter tolerance (local equirectangular approximation for the
  perpendicular-distance check — fine at trail scale). UI is a slider in the
  selected-line editor (only shown above ~20 points), live-applies to the
  actual object like every other slider in this app (color/width/opacity) —
  no separate "confirm" step, consistent with there being no undo anywhere
  else either. The "original" full-resolution coords are captured once when
  the line is selected (component-local state), so the slider can be moved
  up and down freely within that session; deselecting and reselecting later
  starts from whatever the last session left behind, same limitation as
  every other property edit in this app. Simplifying clears
  `waypoints`/`legs`/`snapped` (the routing topology) — the result is a flat
  polyline, same as an import; the UI caption says so.

### Custom overlays — user-supplied WFS catalogs (done 2026-08-25)
Backlog item 9. Scope note: originally floated as "arbitrary XYZ/WMS/GeoJSON
source," but the actual ask (clarified mid-design) is narrower and more
concrete — a generic connector for "someone runs a WFS server with a catalog
of places" (SOTA summits was the illustrative example, not a literal target
integration; **not** PAD-US/MVUM — see item 6, a separate thing). Esri
FeatureServer support (the pattern proven to work for USFS/hillshade) was
deliberately deferred — `protocol: "wfs"` is a field on the persisted def
already, so adding it later needs no migration, just a second code path.

- **`src/lib/layers/customOverlay.ts`**: `CustomOverlayDef` (id/name/url/
  typeName/color/optional labelField), a WFS 2.0 GetFeature query builder, and
  `customOverlayStyleParts()` — geometry-type-filtered style layers (fill/
  line/circle + an optional text label layer for points, all sharing one
  color) seeded onto an **empty** GeoJSON source. Actual feature data is never
  part of the style — it arrives later via `setData()`, the same rule
  drawn-objects/draft already follow, for the same reason: viewport-driven
  data can't go through a style rebuild without refetching from scratch every
  time.
- **Bbox safety guard**: rather than trust a server to honor paging params,
  every fetch requests one page and checks the actual count client-side —
  under the cap (500) renders everything, over it renders **nothing** plus a
  "zoom in" message. Verified this matters: a real request to CDSE's WFS with
  `RESULTTYPE=hits` and `COUNT=3` both silently ignored (server returned all
  matching features regardless), so a pre-flight count request would have
  been theater. Confirmed live in-browser: patching `fetch` to return 600
  features and forcing a refetch left the map's previous 94 real features
  untouched and surfaced the error — never a truncated, silently-wrong set.
- **Gotcha, found only by testing against a real server**: WFS 2.0's 5-part
  `BBOX=w,s,e,n,CRS` form is valid per spec, but CDSE's own WFS (the one
  `sentinel.ts` already talks to) rejects it outright — "Illegal BBOX
  format." `SRSNAME=EPSG:4326` alone already disambiguates axis order
  (confirmed lat-first, matching the existing Sentinel-scene lookup), so the
  CRS suffix on BBOX is now left off entirely, matching the working query
  `sentinelScenes()` already used. A curl-only check wouldn't have caught
  this — curl doesn't enforce or reveal what a *browser* fetch would refuse
  once real, and this bug was in the URL syntax, not CORS at all.
- **Store**: `customOverlays[]` is persisted (localStorage) like
  `offlinePacks` — device-local, deliberately **not** part of saved-map
  documents (a shared/exported map referencing a custom overlay id the
  loading device doesn't have just silently drops that layer, same as any
  other stale reference). `customOverlayStatus` (loading/error per id) is
  runtime-only. `addLayer()`/registry lookups now explicitly fall back from
  the static `layerDef()` to the custom-overlay list at every call site that
  needed it (`ActiveRow`, the stack-insert logic, the compositor) — checked
  each one deliberately rather than adding one shared resolver, since two of
  the five candidate call sites (offline eligibility, the base/overlay
  catalog list) are supposed to keep ignoring custom overlays, not silently
  handle them.
- **MapView wiring**: refetch happens two ways — once right after
  `map.setStyle()` (so a freshly-added overlay's empty source gets populated
  immediately) and again, debounced, on viewport change (mirrors
  `SentinelControls`' existing pattern). Deliberately **not** hosted inside
  the LayerPanel/CustomOverlaySection component tree — LayerPanel defaults
  closed since the mobile pass, and a layer's live data has to keep updating
  while the panel is collapsed. Rendered as an always-mounted, UI-less
  sibling in `MapView`'s own JSX instead.
- **Click-to-inspect**: selecting nothing (no drawn object under the click)
  falls through to a plain property-dump popup for whatever custom-overlay
  feature is there — built with `textContent`, never `innerHTML`, since this
  is the one place in the app that renders a third-party server's arbitrary
  response data into the DOM. Verified end-to-end against real (messy)
  Sentinel-scene metadata with no escaping bugs.
- Verified live against the one real, CORS-open, already-credentialed WFS
  endpoint in the codebase (CDSE, reused from the Sentinel feature — real
  scene-footprint polygons render, opacity/hide/delete/status all work), plus
  a synthetic point+label FeatureCollection to specifically cover the
  SOTA-summit-shaped case (points with a name label) that endpoint doesn't
  exercise.

### Cursor elevation readout + add-marker-by-coordinates (done 2026-08-26)
Two small, ad hoc requests (not backlog table items).

- **Elevation at cursor**: reuses the existing Terrarium DEM point-sample
  function from `elevation.ts` (already powered per-point lookups inside
  `elevationProfile()`, just hadn't been exported) — no new data source.
  Trailing-throttled at 120ms in `MapView`'s existing `mousemove` handler
  (DEM tile reads are cache-backed and fast, but still async, and mousemove
  fires far more often than that), shown as a small bottom-left readout,
  cleared on `mouseout`. `metersToFeet` and `parseLatLng` moved from
  page-local helpers (`ProfilePanel.tsx`'s old `ft()`, `SearchBox.tsx`'s old
  inline regex) into `geo.ts` so both this and the coordinate-entry feature
  below share one implementation instead of two near-identical ones.
- **Add marker by coordinates**: inline "lat, lng" input in the draw-hint bar,
  shown only while the marker tool is active. Reuses the same `parseLatLng`
  SearchBox already used for "jump to these coordinates" — same accepted
  input shape, so it's the one format to remember app-wide. Also flies the
  camera to the new marker, since entering coordinates by hand is usually
  precisely because the point isn't already on screen.

### Custom overlays honor simplestyle-spec colors (done 2026-08-26)
Rex's own SOTA server (now self-hosted at wfs.ke6mt.us, off the ngrok tunnel
from the earlier debugging session) turned out to publish real
[simplestyle-spec](https://github.com/mapbox/simplestyle-spec) properties —
`marker-color` on summit points, `stroke`/`stroke-width`/`fill`/`fill-opacity`
on activation-zone polygons. Worth being precise about what was actually
wrong: this was never a bug in the WFS fetch path — WFS returns raw
geometry+attributes with zero rendering instructions, full stop. GeoServer's
*own* preview looking different is a WMS/SLD thing, a separate protocol this
connector doesn't use and structurally can't inherit styling from. What
*was* missing: `customOverlayStyleParts()` only ever applied one flat color
for the whole source, ignoring styling properties already sitting right in
each feature.

Fixed generically, not SOTA-specifically: every color/opacity paint property
now reads `["coalesce", ["get", <simplestyle-property>], <overlay's own
color>]`, so a feature's own `marker-color`/`stroke`/`fill` wins when
present, and any other WFS source lacking these properties falls back to
the source's configured color exactly as before — verified both cases
live against wfs.ke6mt.us (real per-feature colors render; a wide-area query
against summits with no activation-zone polygon in view still rendered
fine). `marker-symbol` (present as e.g. `"circle-2"`) is deliberately not
handled — simplestyle's numbered/lettered marker convention doesn't map onto
this app's own fixed 12-icon set, and would need a real Maki-icon renderer
to do properly; flagged as a separate, bigger decision rather than guessed
at.

### Numbered/lettered marker-symbol badges (done 2026-08-26)
Follow-on to the above, once Rex asked about CalTopo icon-set parity.
Checked before building anything: CalTopo's own icon vocabulary is
undocumented and explicitly subject to change per their own community posts
— no stable public target to match. simplestyle-spec's own convention,
though, *is* public and stable: `marker-symbol` as a bare digit "0"-"9" or
letter "a"-"z" means "numbered/lettered circle marker." Implemented that,
plus the literal `"circle-N"` form (N 1-2 digits) since that's what real
data in the wild (the SOTA server) actually emits — verified live values up
to `"circle-10"` (SOTA's max summit point value) before picking a regex, so
the 1-2-digit case wasn't a guess. `markerBadge()` in `customOverlay.ts`
extracts the badge character once per fetch (not per-render — MapLibre's
expression DSL has no regex, so this has to happen in JS, not in the style),
stamping a `__markerBadge` property onto qualifying point features; a new
symbol layer renders it centered on the marker circle, independent of the
optional below-marker `labelField` text. Verified against real summits
(Grays Peak, Mount Blue Sky, etc. correctly showing "10"; others showing 8/
6/4) at a real zoom level, legible and correctly colored per-feature.
Named Maki icons (e.g. `"campsite"`) remain deferred, per the same
undocumented-vocabulary reasoning above.

### Custom overlays: stop refetching on opacity, debounce pan/zoom (done 2026-08-26)
Rex noticed a "Loading…" flicker (layout shift in LayerPanel) whenever
changing *any* layer's opacity, not just while panning/zooming — and asked
directly whether opacity changes were hitting the WFS server. They were:
every style rebuild refetched every active overlay unconditionally, and
`setOpacity()` on any stack entry (including an unrelated layer) produces a
new `stack` array reference, which the rebuild effect treats as a change.
Verified via real network capture (not just code reading) before and after
the fix — 5 opacity changes in a row now produce exactly 0 WFS requests,
whether on the overlay's own entry or a completely different layer.

Fixed by keying the refetch (both the post-setStyle "populate a freshly-
active overlay" call and `CustomOverlayData`'s viewport-driven refetch) on a
derived signature — the sorted set of overlay ids actually rendered
(`visible && opacity > 0`, mirroring the compositor's own skip condition
exactly) — instead of the raw `stack`/`customOverlays` array references.
Opacity moving within (0, 1] no longer changes the signature at all; it
only changes crossing the 0 boundary or on add/remove/visibility-toggle,
which correctly still refetch (verified: hide → 0 requests, show again → 1).
Also bumped the pan/zoom settle debounce 400ms → 800ms per Rex's request, so
a flurry of small adjustments coalesces into one fetch instead of firing
after every brief pause — verified 5 rapid pans ~150ms apart produce exactly
1 request, timed after the last one.

**Real regression caught mid-fix, worth remembering generally**: the first
version of this fix wrote the "have we already refetched this signature"
ref eagerly at the top of the effect, before the async `buildStyle()` call
resolved. Next's dev-mode Strict Mode double-invokes effects on mount
(mount → cleanup → mount again) — the first invocation's cleanup set
`cancelled = true`, but by then it had already written the ref, so the
*surviving* second invocation saw "signature unchanged" and skipped its own
fetch entirely. Net effect: a brand-new overlay's source loaded 0 features
on first render, no error, nothing in the console — the kind of bug that
only real load-then-inspect verification catches, not code review. Fixed by
moving the compare-and-set inside the same `cancelled`/`seq` guard the
fetch itself already used, so a cancelled run can never claim the
signature.

**Second real bug, caught by Rex after deploy**: gating the *refetch* wasn't
enough — the *style rebuild itself* still runs on every opacity change
(`stack` changes reference regardless of which field changed), and the
compositor always seeds a custom overlay's source with an empty
FeatureCollection, full stop, since a plain style spec has no way to encode
"whatever was last fetched." Without a real refetch to repopulate it, an
opacity-only rebuild left every custom overlay blank until the next pan/zoom
happened to trigger one. Fixed by caching each overlay's last successfully
fetched FeatureCollection (`cachedOverlayData()` in customOverlay.ts) and
reapplying it via `setData()` right after *every* rebuild, unconditionally —
cheap, no network, keeps the display continuous — while the actual refetch
stays gated on the signature exactly as before. Verified live: 60 rendered
point features immediately before and after an opacity change on an
unrelated layer, 0 requests either way.

### Account-scoped storage: identity verification + custom overlays go server-side (done 2026-08-27)
Rex asked whether custom WFS overlays are saved — they weren't; `customOverlays`
lived only in this store's localStorage `persist`, so a new browser/device saw
none of them. That surfaced a real architecture gap: rexMaps has never had any
per-user concept — `maps` is (and remains) one shared D1 pool, and nothing in
the app ever reads *who* is asking. Rex chose **private per person** ("like
CalTopo — a layer another user can't access just doesn't show for them") and
used the moment to lay out a longer roadmap: user accounts, other identity
providers (Google etc.), a layer-vs-overlay toggle for custom sources, no-auth
map sharing, and a mobile-native app. Scoped this pass to the concrete,
unblocking piece — custom overlays, now server-backed and private per account
— and left the rest as backlog (see table below), each item noting what this
pass does or doesn't set up for it.

**Identity, not auth** — this does not add in-app authentication, which
AGENTS.md rules out (Access at the edge is the only auth boundary). It reads
the identity Access already established for the request. `src/lib/access.ts`
cryptographically verifies the `Cf-Access-Jwt-Assertion` JWT against Access's
own JWKS (`https://<team-domain>/cdn-cgi/access/certs`, fetched live — keys
rotate every ~6 weeks, never hardcoded) and checks `iss`/`aud`, rather than
trusting the `Cf-Access-Authenticated-User-Email` header alone (that header
isn't itself authenticated as far as the Worker can tell). Verified against
Cloudflare's own current docs, not prior training knowledge — a deliberate
retrieval given this is a security-relevant design choice. The identity itself
is treated as an **opaque string** (not assumed email-shaped) so a second IdP
later (backlog #2) needs no rework here.

**New D1 table**: `custom_overlays(id, owner, name, url, type_name, color,
label_field, created_at)` (`migrations/0002_create_custom_overlays.sql`) —
`owner` is the verified identity string; every query is scoped to it
(`WHERE owner = ?1`), including deletes (`WHERE id = ?1 AND owner = ?2`, so
guessing another id can't delete someone else's row — verified live: seeded a
second owner's row directly in D1, confirmed DELETE against it 404s while
DELETE against your own row succeeds). `maps` is deliberately untouched —
still the one shared pool; retrofitting ownership onto it is backlog, not
this pass.

**API**: `/api/custom-overlays` (GET list / POST create) and
`/api/custom-overlays/[id]` (DELETE), mirroring the existing `/api/maps`
route shape (`getCloudflareContext().env.DB`). POST validates server-side
(`parseCustomOverlayInput` in `src/lib/customOverlaysApi.ts` — https-only URL,
non-empty fields, 6-hex color) since this is now a real endpoint any
Access-authenticated family member can reach directly, not just through the
form; the same validator runs client-side too so the check exists once.

**Client refactor**: `customOverlays` came out of the zustand `persist`
partialize list entirely — it's fetched once from the server
(`loadCustomOverlays()`, called from `MapView`'s init effect) rather than
rehydrated from localStorage. `addCustomOverlay`/`removeCustomOverlayDef`
changed from synchronous store methods to plain exported async functions
(matching the existing `appendDraftPoint`/`refitObjectVertex` pattern) that
call the API first and only touch local state — including removing an id from
`stack` — on success, so a failed request can't leave the UI showing something
the server doesn't have. A new `customOverlaysLoaded` flag lets the UI
distinguish "still loading" from "genuinely zero overlays."

**Startup-order race, checked rather than assumed**: a saved map's `stack`
can reference a custom-overlay id before the async `loadCustomOverlays()`
fetch resolves (`stack` itself still rehydrates synchronously from
localStorage). Verified via CDP — seeded `stack` with a real overlay id on a
fresh load — that this self-heals with no manual pan/zoom: `customOverlays`
arrives, the build effect's existing dependency on it fires, the overlay's
signature flips from absent to present, and 60 features render. `stack`
referencing an overlay owned by someone else (relevant once maps/sharing
exist) is left to silently omit, per Rex's own "like CalTopo" framing — no
error path needed there.

**Local dev**: Access itself never fronts `next dev`/`opennextjs-cloudflare
preview` — no real JWT is ever available to verify locally. Added a
`CF_ACCESS_DEV_IDENTITY` escape hatch, checked first before any JWT
verification runs, in `.dev.vars` only — so both `dev` and `preview` stay
fully testable locally. Deliberately absent from `wrangler.jsonc`'s `vars`
and must never become a deployed secret, or the real Worker would trust any
request as that identity. Verified the fail-closed direction too: with the
var unset and no real Access JWT present, the API 401s rather than falling
back to anything.

**Not yet live**: `wrangler.jsonc`'s `vars.CF_ACCESS_TEAM_DOMAIN` /
`CF_ACCESS_AUD` are placeholders (empty string — fails closed, not open,
until filled in). Needs the real values from Rex's Zero Trust dashboard
(team domain: Settings → Custom Pages; AUD: the rexmaps Access application's
Overview tab) before the deployed custom-overlays API will authenticate
anyone.

### Custom overlays: choose which WFS fields to load (done 2026-08-27)
Rex's own WFS server (wfs.ke6mt.us, `rexington/sota-wfs` on GitHub) documents
a manual CalTopo setup path using `PROPERTYNAME` to restrict which fields a
WFS `GetFeature` request returns, and asked for the same ability here — not
by accepting WFS 1.0/1.1-style pasted URLs (its README's manual templates
use `VERSION=1.1.0`), just the field-restriction capability itself.

Verified live against his server before assuming anything: **`PROPERTYNAME`
works identically under the `VERSION=2.0.0` request shape this app already
sends** — no need to carry a second request format just for this. Also
verified geometry survives regardless of whether it's listed (his README's
templates include `the_geom` defensively; empirically unnecessary against
his server, and there's no way to verify it's unnecessary against WFS
servers in general — the form's hint doesn't promise it either way).

New optional `propertyNames` field on `CustomOverlayDef`, threaded through
exactly like `labelField` (same layers, no new pattern): the add-overlay
form, `parseCustomOverlayInput` (normalizes whitespace — `"a, b"` and `"a,b"`
store and query identically — shared client/server as usual), the
`custom_overlays` D1 table (`migrations/0003_custom_overlays_property_names.sql`,
additive nullable `ALTER TABLE`, safe on existing rows), the API routes, and
`wfsUrl()` in `customOverlay.ts`. One deliberate deviation from "just what
the user typed": `wfsUrl()` always adds `labelField` to the request if it's
missing from the property list, since a server that (unlike Rex's) doesn't
unconditionally include its own styling fields would otherwise silently
break the one field the map label depends on — simplestyle fields
(`marker-color` etc.) are deliberately *not* auto-added the same way, since
requesting a field a server doesn't have throws a WFS exception on some
servers, and Rex's own already includes them regardless (verified).

Verified end-to-end via CDP against the real server: the built request URL
carries `PROPERTYNAME` with the normalized field list; points and labels
both still render when the label field is left out of the typed list
(auto-injected into the actual request, confirmed present in labels
rendered). No edit UI exists for any overlay field (same scope line as the
account-scoping pass above) — changing the list means delete and re-add.

### Split line at a vertex (done 2026-08-27)
Rex's use case: an imported out-and-back GPX track, wanting just the
outbound half. Scoped to splitting at an existing vertex (not an arbitrary
point along a leg) — the drag-handle system already renders one at every
waypoint, including every raw coordinate of a topology-less import, so no
new hit-testing or leg-interpolation was needed; a turnaround point in a
real out-and-back is a real recorded trackpoint anyway, not a point you'd
need to invent mid-leg.

New `splitting: boolean` store flag (cleared automatically on tool change,
reselection, or deleting the line being split — never allowed to go stale
against `selectedId`). A new "Split" button in the selected-line editor
(`ObjectsPanel.tsx`, gated on having an interior vertex — `obj.waypoints
?.length ?? obj.coords.length > 2`, computed without running the O(n)-
allocating `lineTopology()` derive path on every row render) arms it;
`MapView`'s existing `mousedown`-on-handle path (not `click` — handles are
already a drag gesture, so that's where the event actually fires) branches
to `splitObjectAtVertex(id, idx)` instead of starting a drag when armed.
Cursor turns crosshair over a handle while armed; `DrawHint` shows a cancel
chip; Escape backs out without deselecting.

`splitObjectAtVertex()` (mapStore.ts) slices `lineTopology()`'s
waypoints/legs/snapped at the clicked index into two new line objects,
replacing the original — a no-op at either endpoint. Both halves always
carry explicit topology, even for a plain import that had none, since
`lineTopology()` already derives the identical shape on the fly; this just
makes it permanent. The first half **keeps the original title**; only the
second gets a `(2)` suffix — split-then-delete-the-unwanted-half is the
expected flow, and a lone survivor titled "Trail (1)" would misleadingly
imply a sibling that's already gone.

Verified against a synthetic 2999-point out-and-back (the real shape of a
dense GPX import, not a hand-drawn 4-point line): a real CDP mouse event at
the projected pixel of the turnaround vertex produced two objects whose
combined coordinate count was exactly original+1 (the split vertex appears
in both halves, nothing dropped or duplicated). Screenshotted at zoom 16 to
check the actual concern with thousands of same-radius handle circles —
they render as a clean, individually-clickable "chain of pearls" once
zoomed in past whatever the ambient point density needs, same zoom-dependent
usability the existing vertex-drag feature already has. The turnaround
itself is the one point on an out-and-back that's never ambiguous to click,
since it's the only vertex without a nearby twin from the return leg.

### Tracestrack Topo layer + OSM "query features" (done 2026-08-27)
Two independent asks in one message, kept as two features rather than one:

**Tracestrack Topo** (`tracestrack-topo` in registry.ts): an OSM-derived
raster topo base layer with terrain shading — visually stronger than USGS
Topo. Needs a per-account key (Rex signed up and supplied his own;
`NEXT_PUBLIC_TRACESTRACK_KEY`) — the site itself blocks automated fetches,
so pricing/terms weren't independently confirmed beyond Tracestrack's own
"free for non-commercial use" framing. Wired through the same
`"google-session"`/`"sentinel-cdse"` sentinel-token pattern in
`RasterLayerDef.tiles` (now also `"tracestrack"`), resolved in
`compositor.ts`'s `rasterEntry()`. Verified live: 512px native tiles (no
`@1x` suffix needed — confirmed by fetching one and checking pixel
dimensions directly rather than trusting an issue-title inference), max z19,
attribution merges correctly alongside other active layers. Excluded from
offline packs (`offlineEligibleLayers()`/`layerAssets()`) — conservatively,
since unlike Google's explicit no-cache clause, Tracestrack's
caching/redistribution terms aren't confirmed either way; worth revisiting
if Rex checks. **The key lives only in `.env.local` (gitignored) on this
machine** — same tradeoff as the Google key already had, just newly worth
naming: a deploy built from anywhere else loses it silently (the layer just
disappears via `missingKeyReason`'s existing "no key" skip), not an error.

**OSM "query features"** (`src/lib/osmQuery.ts`, new `"query"` tool):
click the map, see what OpenStreetMap knows about that spot — same idea as
osm.org's own right-click menu item. Backed by the free public Overpass API
(no key, CORS `*` verified live, ~10k req/day public etiquette — one
request per click is nowhere close). Rex's stated primary use case,
clarified after the first pass: seeing what forest/wilderness/protected
area *encloses* a spot, not just what's nearby — a real design fork from
"OSM's Query features" as originally scoped. A small-radius `around` search
only matches geometry passing near the point; it can't find a polygon whose
*interior* contains the point without touching its boundary (verified: an
`around` query deep inside Rocky Mountain National Park returns nothing).
Fixed by adding Overpass's `is_in(lat,lon);area._;` to the same query,
returning enclosing areas — parks, wilderness, admin boundaries — verified
against a real point inside RMNP, correctly returning both the park and the
wilderness area within it. One query, two result sets: "Encloses this spot"
(is_in, sorted protected/reserve areas first, then administrative
county→state→country, then everything else) and "Nearby" (the original
small-radius search, closest first).

Tags are curated (`curatedTags()`, an allowlist), not dumped raw — an admin
boundary like "United States" carries 300+ tags (one per language's
translated name) that would otherwise flood the popup. A real bug this
surfaced: an element whose only raw tag was an uncurated one (e.g. an
unnamed building tagged just `building=retail`) showed a heading derived
from that tag's value with an empty "No attributes" table underneath —
confusingly self-contradictory. Fixed by dropping any element with zero
curated tags entirely, and by deriving the heading's fallback label from
the curated tags too, not the raw ones, so the heading can never reference
something the table doesn't show.

**A real bug caught only by testing against the actual deployed code path,
not the curl commands used to design the query**: Overpass QL requires a
trailing `;` on the last statement inside a union block before its closing
`)` — verified working via curl with that semicolon present, then dropped
by mistake while transcribing the verified string into the TypeScript
template literal, which 400'd. Caught immediately by running the real
click-through-the-UI flow via CDP rather than trusting the curl
verification alone.

### In-app auth: Google Sign-In, replacing Cloudflare Access (in progress, started 2026-08-28)
Started as a request to design backlog #18 (public map share links). Access
turned out to be the wrong foundation for it: worker-level Access is an
all-or-nothing edge switch, so "this one map is public" meant a separate,
narrower, path-scoped Access **Bypass** Application layered on top — real
and workable (confirmed against current Cloudflare docs: hostname/path-scoped
apps evaluate before, and win over, worker-level Access) but with real
friction once actually enumerated: the bypass set isn't just the map-view
route, it's every static asset that route loads (`/_next/static/*`, the
MapLibre worker files), bypassing those makes the whole client JS bundle —
and the client-exposed API keys baked into it — fetchable by anyone, and the
whole mechanism is manual dashboard config repeated per future public
surface, with no route to self-serve signup at all. Rex named the real
problem directly: Access fit "secure the whole app," not "per-resource
visibility, with signup later" — the requirements had outgrown it.

**Chosen approach**: hand-rolled Google OpenID Connect rather than an auth
library. The deciding argument was that the verification code already
existed and was already proven — `src/lib/access.ts`'s Access-JWT check is
`createRemoteJWKSet` + `jwtVerify` against a live JWKS, checking iss/aud;
`src/lib/auth.ts` does the identical shape against Google's JWKS instead.
`jose` was already a dependency, D1 was already wired. A library (Better
Auth was the alternative considered) would have meant verifying its
Workers/OpenNext runtime behavior before trusting it with security code —
that verification, not the code itself, would have been the actual cost.

**What Access was quietly providing, now built explicitly**:
- **Sessions**: D1-backed (`users`, `sessions` — `migrations/0004_create_users_sessions.sql`),
  not a self-contained signed cookie, so a session can be revoked (`DELETE`)
  rather than only expiring on its own.
- **Per-route authorization**: every `/api/maps/*` and `/api/custom-overlays*`
  handler now calls `sessionUser(req, env)` explicitly and 401s on null —
  previously implicit, since Access sat in front of the whole Worker.
  `custom_overlays`' existing per-owner scoping (`WHERE owner = ?1`) is
  unchanged, just fed by the session's email instead of the Access JWT's.
- **`owner` on `maps`** (backlog #16, `migrations/0005_maps_add_owner.sql`,
  backfilled to Rex): bundled into this pass since "is this map public" and
  "who may edit it" are both real per-row facts now that there's more than
  one identity concept in play. Deliberately *not* an edit restriction —
  `maps` stays a shared pool, any signed-in user may still edit any map,
  matching the behavior Access already provided.
- **A gate on who can sign in**: `AUTH_ALLOWED_EMAILS`, checked once at first
  sign-in (not re-checked per request). An entry starting with `@` matches a
  whole domain — deliberately mirroring the Access policy this replaces
  (which allowed all of `vokey.org`, not one address — "Rex is fine with
  family members having access," 2026-08-25) rather than quietly narrowing
  access as a side effect of swapping mechanisms. Set to `@vokey.org`.
- **The app shell itself** now has to branch on auth state — `/` is
  reachable by anyone once Access stops gating it, so `AuthGate` (wrapping
  `MapApp` in `page.tsx`) checks `/api/auth/me` on mount and shows a plain
  "Sign in with Google" prompt instead of the editor when signed out. This
  is *not* the landing/marketing page Rex separately floated and this pass
  deliberately left out of scope — no new route, no new content, just the
  existing shell reading session state.

**Sequencing, deliberate**: built and shipped with Worker-level Access left
**on**. The new session/authz code runs behind Access exactly like
everything else does today; every route already rejects an unauthenticated
request on its own (verified locally pre-deploy: 401 on `/api/maps` and
`/api/custom-overlays` with no session cookie, correct Google consent-screen
redirect with a state cookie from `/api/auth/login`, clean 400s on
missing/mismatched OAuth state, a clean 502 — not a crash — on a bogus
authorization code exchanged against Google's real token endpoint; schema
verified locally then applied to the remote D1). Confirmed post-deploy that
Access still fronts `maps.ke6mt.us` exactly as before (a bare curl still
gets redirected to the Access login) — this pass changed nothing about the
edge boundary yet, only added a second, independent gate behind it.
**Turning off Worker-level Access is a deliberate later step**, done only
once Rex has completed a real interactive Google sign-in against the live
app (the one leg that can't be verified without his actual Google account)
and the whole flow is confirmed solid. `src/lib/access.ts` becomes unused
dead code at that point — remove it then, not before.

**Still open**: Access isn't off yet; `src/lib/access.ts` is still present
but now unused by any route; the actual public-map-link feature (backlog
#18 — `is_public` column, `/m/[id]` view, `/api/public-maps/[id]`) is next,
and is genuinely simpler now — a route that just skips the `sessionUser()`
check on purpose, no Bypass-Application/static-asset gymnastics required.

## Backlog / ideas

Ordered by rough lift, cheapest first, so it's easy to pick a next few. These
are gut-check buckets, not estimates: **S** = follows a pattern already built
in this app, low risk, roughly a session; **M** = real design decisions but
bounded scope, roughly a session or two; **L** = a new subsystem, real
data-sourcing/research risk, or multiple sessions.

| # | Effort | Category | Item | Notes |
|---|--------|----------|------|-------|
| 1 | S | Drawing/Objects | ✅ Per-object opacity; adjustable width for polygon outlines + marker size | Done 2026-08-25 — see notes below |
| 2 | S | Access | ✅ Google as identity provider | Superseded 2026-08-28 — Google OIDC became the *primary* (only) sign-in method, not a 2nd one alongside Access. See decision log |
| 3 | M | Drawing/Objects | ✅ Line/track simplification | Done 2026-08-25 — see notes below |
| 4 | M | Drawing/Objects | ✅ Marker styles — icon picker, CalTopo-style but better | Done 2026-08-25 — see notes below |
| 5 | M | Saved maps | Folders for saved maps | New D1 table (`folders`) + API route + UI grouping in the saved-maps list — second table in the schema, first one was just `maps` |
| 6 | M | Layers/Data | Public land ownership + MVUM (motor-vehicle use maps) overlays | PAD-US/BLM likely already have a free ArcGIS REST service — same registry pattern already used for USFS Basemap/hillshade, needs confirming |
| 7 | M | Presentation | 3D terrain view | MapLibre has native `raster-dem` terrain support with an `encoding: "terrarium"` option — reuses the exact DEM tiles already fetched for elevation profiles/slope shading, mostly wiring rather than new data work |
| 8 | M | Presentation | Printing to PDF at scale | Static canvas render + scale-accurate paper layout (map scale bars must stay correct at print DPI) |
| 9 | L | Layers/Data | ✅ Custom overlays — user-supplied WFS point/line/polygon catalogs | Done 2026-08-25 — see notes below |
| 10 | L | Layers/Data | Private land ownership (parcels) | No free unified national dataset — parcels are county-by-county, wildly inconsistent. May be better solved *by* item 9 (let Rex plug in his own county's GIS parcel service) than by rexMaps building/maintaining a national layer |
| 11 | L | Layers/Data | Classic scanned FSTopo quads, self-hosted | Real data pipeline: georeferenced GeoTIFFs from USFS FSGeodata → PMTiles → R2, plus a new tile protocol to serve them (same shape as the `slope://`/`sentinel://` custom protocols) |
| 12 | L | Layers/Data | Weather (NOAA forecast grids) + snow depth (SNODAS) overlays | Not simple XYZ tiles — GRIB/WMS sources likely need real conversion, unlike the ArcGIS-pattern layers above |
| 13 | L | Collaboration | Live multi-user / live location sharing | Needs Durable Objects + WebSockets. The worker-level-Access-403s-on-WebSockets caveat (Stage 5) goes away once Access is fully retired (backlog, in progress — see decision log 2026-08-28); auth/authz is now per-route app code either way |
| 14 | L (gated) | Infra | Worker-proxy + R2/Cache tile caching for Sentinel | **Only relevant if the app goes multi-user** — quota is per CDSE instance ID. Pointless solo: ~1–2k of the 10k monthly requests used, and the rolling `TIME` window makes recent-imagery tiles cache-hostile anyway. Google tiles excluded regardless (ToS forbids caching/proxying) |
| 15 | S | Layers/Data | ✅ Custom overlays: private per-account, server-backed | Done 2026-08-27 — see notes above. Identity-verification foundation (`src/lib/access.ts`) this row's approach reuses |
| 16 | M | Saved maps | ✅ Ownership retrofit on `maps` | Done 2026-08-28, bundled into the auth-migration pass (see decision log) — `owner` column added, backfilled to Rex. Deliberately *not* scoped to owner-only writes: `maps` stays a shared, any-signed-in-user-may-edit pool, same as before; `owner` just records who created each row |
| 17 | M | Layers/Data | Layer-vs-overlay toggle for custom sources | Let a custom WFS source be treated as a base layer (bottom-insertion, vector-exclusivity rules) instead of always an overlay — `addLayer()`'s vector/raster insertion logic in mapStore.ts would need a third case |
| 18 | M | Collaboration | No-auth map sharing (share link, read-only) | The original ask that triggered the auth migration (2026-08-28) — a single map viewable via a direct link, no sign-in. Was going to need a Cloudflare Access path-Bypass Application + careful static-asset enumeration; now that auth is in-app, it's just a route that skips the `sessionUser()` check on purpose. Not yet built — comes after Access is fully retired (see decision log) |
| 19 | L | Platform | Mobile-native app (iOS, then Android) | Rex-stated future direction, no design work done yet. `maps`/`custom_overlays` already being real API-backed (not just localStorage) is what makes this feasible at all — a native client would talk to the same `/api/*` routes |

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
- **2026-08-27** Account/ownership architecture: chose **private per person** over a shared pool for anything new (Rex, deliberately — "like CalTopo," an inaccessible layer just doesn't show). Built the identity-verification foundation (`src/lib/access.ts` — verifies the Access JWT, not the authenticated-user-email header) and applied it to custom overlays first, since that gap was concrete and already found (localStorage-only, invisible on a second device). `maps` stays a shared pool for now; retrofitting ownership onto it is backlog #16, not bundled into this pass. Longer roadmap (2nd IdP, layer/overlay toggle, no-auth sharing, mobile-native) captured as backlog #2/#17/#18/#19.
- **2026-08-28** Auth reversed: **Cloudflare Access replaced by in-app auth** (Google OIDC + D1 sessions). Started as a request to design backlog #18 (public map share links); researching the mechanism (a path-scoped Access Bypass Application, verified against current Cloudflare docs — more-specific-path rules win over worker-level Access) surfaced real friction Rex then named directly: Access is an all-or-nothing edge switch, expressing "this one map is public" as path gymnastics plus manual per-surface dashboard config was the wrong shape, and it has no route to self-serve signup at all. See "In-app auth" write-up below for what shipped and what's still open (Access itself isn't off yet).
- **2026-08-24** Stage 4: Sentinel imagery via **CDSE Sentinel Hub WMTS** (user created a CDSE account; 10 m beats GIBS HLS's 30 m; free tier 10k req/mo). Slope shading is computed client-side through a MapLibre custom protocol rather than pre-rendered tiles — zero hosting cost, works offline once DEM tiles are cached, and reuses the Terrarium pipeline from elevation profiles. Nominatim search is Enter-only to respect their no-autocomplete policy. Line hit-testing got a ±4 px box (user feedback: thin lines were hard to click); object rename input got an explicit white background (was transparent over the panel).
