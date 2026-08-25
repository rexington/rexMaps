# rexMaps

A personal CalTopo-style mapping app for hiking and trail running: stackable
map layers with opacity/reorder controls, route planning with snap-to-trail
routing, and saved maps — running on Cloudflare Workers for ~$0/mo.

**Start here:** [docs/PLAN.md](docs/PLAN.md) (staged roadmap + decision log) and
[docs/LAYERS.md](docs/LAYERS.md) (every tile source, with endpoints and terms).
Agent guidance lives in [AGENTS.md](AGENTS.md).

## Develop

```bash
npm run dev        # Next.js dev server (http://localhost:3000)
npm run preview    # build + run in the Workers runtime locally
npm run deploy     # build + deploy to Cloudflare Workers
```

Optional: copy `.env.example` → `.env.local` and set a Google Map Tiles API key
to enable the Google Satellite / Google Maps layers. Everything else works
keyless.

## Stack

Next.js 16 (App Router) · MapLibre GL v6 · zustand · Tailwind v4 ·
`@opennextjs/cloudflare` on Workers · D1 (saved maps, upcoming) ·
Cloudflare Access for auth at the edge.
