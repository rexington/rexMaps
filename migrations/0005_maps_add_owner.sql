-- `maps` stays a shared pool (any signed-in user may edit any map — see
-- docs/PLAN.md, backlog #16) but now records who created each one, both for
-- display and as groundwork for the public-map-link feature (a map's
-- visibility is a per-row fact, same as its owner). Existing rows predate
-- any identity concept at all, so they're backfilled to Rex.
ALTER TABLE maps ADD COLUMN owner TEXT NOT NULL DEFAULT 'rex@vokey.org';
