-- Custom WFS overlay definitions, scoped per authenticated identity (the
-- Access-verified email — see src/lib/access.ts). Unlike `maps`, which is
-- still a shared pool, these are private per person from the start.
CREATE TABLE IF NOT EXISTS custom_overlays (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type_name TEXT NOT NULL,
  color TEXT NOT NULL,
  label_field TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_custom_overlays_owner ON custom_overlays (owner);
