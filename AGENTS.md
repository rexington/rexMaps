<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# rexMaps

Personal CalTopo-style mapping app (hiking / trail running) for rex@vokey.org.
**Read `docs/PLAN.md` first** — it has the staged roadmap, current status, and
decision log. `docs/LAYERS.md` catalogs every tile source with endpoints/terms.

## Stack
- Next.js 16 (App Router, client-heavy SPA) on **Cloudflare Workers** via
  `@opennextjs/cloudflare`. Deploy: `npm run deploy`; local CF preview:
  `npm run preview`; plain dev: `npm run dev`.
- MapLibre GL v6 + zustand (`persist` → localStorage) + Tailwind v4 + dnd-kit.
- D1 (saved maps, Stage 2+): binding commented in `wrangler.jsonc`; access via
  `getCloudflareContext().env` in route handlers.
- Auth is **in-app**: Google OpenID Connect + D1-backed sessions
  (`src/lib/auth.ts`, `sessionUser()`) — never Cloudflare Access, which was
  used through 2026-08-28 and is now fully removed (both the dashboard
  config and `src/lib/access.ts`). Reversed because Access was an
  all-or-nothing edge switch: no way to let one route (e.g. a public
  shared-map view) through while keeping the rest gated, and no route to
  self-serve signup. `/` and every route are reachable at the edge now —
  authorization is `sessionUser()` on each handler, not an edge gate. See
  docs/PLAN.md decision log.

## Architecture invariants
- All tile/layer access is declared in `src/lib/layers/registry.ts` and rendered
  by the compositor (`src/lib/layers/compositor.ts`), which rebuilds a full
  MapLibre style from the active stack and applies it with `setStyle(style,
  {diff: true})`. Never add ad-hoc `map.addLayer` calls outside the compositor.
- Drawn objects + in-progress draft are the compositor's topmost layers
  (`src/lib/layers/objectLayers.ts`), fully data-driven (color/selected feature
  props). Object edits, selection, and draft updates go through
  `GeoJSONSource.setData` (see MapView's store subscription) — never a style
  rebuild, and never new layers.
- Layer stack order in the store = visual order, index 0 bottom.
- At most one vector layer active at a time (single glyphs URL); UI enforces.
- Panels reach the map only via `src/lib/mapRef.ts`, and only for camera moves.
- Keep everything offline-capable in principle (Stage 6): no hidden fetches of
  map data outside the registry/compositor path.

## Budget guardrail
Target ~$0/mo. Do not add paid APIs or paid Cloudflare features without asking
the user. Google Map Tiles API is the single sanctioned metered service.

