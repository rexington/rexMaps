-- In-app auth (replacing Cloudflare Access as the user-facing gate — see
-- docs/PLAN.md and src/lib/auth.ts). `users` is created lazily on first
-- successful Google sign-in from an allowlisted address; `sessions` backs
-- the session cookie so a session can be revoked by deleting its row,
-- rather than only expiring on its own.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
