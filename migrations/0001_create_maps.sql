-- Saved maps: one row per map; `data` is the full JSON snapshot
-- ({ objects, stack, viewport }) — see src/lib/savedMaps.ts.
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_maps_updated ON maps (updated_at DESC);
