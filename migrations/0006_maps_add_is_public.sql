-- A map made public gets a no-sign-in-required view at /m/[id]
-- (src/app/api/public-maps/[id]/route.ts) — the map's own id doubles as its
-- share link, CalTopo-style: no separate token, so toggling public off then
-- back on re-exposes the same URL rather than rotating it.
ALTER TABLE maps ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
