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
- Auth is **Cloudflare Access** at the edge — never add in-app auth.

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

