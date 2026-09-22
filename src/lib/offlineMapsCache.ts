import type { SavedMapData, SavedMapSummary } from "./savedMaps";

/**
 * Local read-through cache for saved maps, so the saved-maps list and any
 * previously-opened map are still browsable/loadable with no connection —
 * see docs/PLAN.md's offline-sync write-up. Plain localStorage (small JSON
 * blobs, same origin/quota as the existing zustand-persist store already
 * uses) rather than new persistence tech, per this app's Stage 6b precedent.
 *
 * A cached map body doubles as the merge "base" the next time this map is
 * saved (see mapMerge.ts) — so the one rule that must never be broken:
 * `cacheMapBody` is only ever called right after a successful *live* fetch
 * or a successful merged save, never from an offline load. Calling it at the
 * wrong time makes base == mine, which silently hides real offline edits
 * from the next merge instead of detecting them.
 */

const LIST_KEY = "rexmaps-offline-maps-list";
const BODIES_KEY = "rexmaps-offline-maps-bodies";
const MAX_CACHED_BODIES = 20;

export interface CachedMapBody {
  id: string;
  title: string;
  data: SavedMapData;
  isPublic: number;
  cachedAt: number;
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private-browsing storage denial — the cache is a
    // best-effort convenience, not a source of truth, so just drop it.
  }
}

export function cacheMapsList(list: SavedMapSummary[]): void {
  writeJSON(LIST_KEY, list);
}

export function getCachedMapsList(): SavedMapSummary[] | null {
  return readJSON<SavedMapSummary[]>(LIST_KEY);
}

export function cacheMapBody(id: string, title: string, data: SavedMapData, isPublic: number): void {
  const bodies = readJSON<Record<string, CachedMapBody>>(BODIES_KEY) ?? {};
  bodies[id] = { id, title, data, isPublic, cachedAt: Date.now() };

  const entries = Object.values(bodies).sort((a, b) => b.cachedAt - a.cachedAt);
  const kept = entries.slice(0, MAX_CACHED_BODIES);
  const trimmed: Record<string, CachedMapBody> = {};
  for (const entry of kept) trimmed[entry.id] = entry;

  writeJSON(BODIES_KEY, trimmed);
}

export function getCachedMapBody(id: string): CachedMapBody | null {
  const bodies = readJSON<Record<string, CachedMapBody>>(BODIES_KEY);
  return bodies?.[id] ?? null;
}
