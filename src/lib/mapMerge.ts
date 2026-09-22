import type { SavedMapData } from "./savedMaps";
import type { MapObject } from "./objects";

/**
 * Three-way merge for a saved map's drawn objects, keyed by `MapObject.id`
 * (crypto.randomUUID() per object — see objects.ts — so two independently
 * added objects never collide). `base` is the map as it stood at the last
 * confirmed sync with the server; `mine` is the local (possibly offline)
 * working copy; `theirs` is whatever the server holds now. Resolving this
 * per-object rather than as one JSON blob means two people editing
 * *different* objects while one is offline never clobbers either change —
 * only a genuine same-object edit on both sides needs a tie-breaker.
 *
 * Tie-breakers (confirmed with the app's owner, since these are calls about
 * shared family data, not obvious defaults):
 * - An edit beats a delete, symmetrically — a delete is easy to redo, a
 *   silently-lost edit isn't.
 * - A genuine same-object double-edit keeps `mine` — the device actively
 *   reconnecting and saving is treated as authoritative for what it
 *   touched, rather than trusting cross-device clocks for recency.
 */
export function mergeObjects(
  base: MapObject[],
  mine: MapObject[],
  theirs: MapObject[],
): { merged: MapObject[]; conflicts: number } {
  const baseById = new Map(base.map((o) => [o.id, o]));
  const mineById = new Map(mine.map((o) => [o.id, o]));
  const theirsById = new Map(theirs.map((o) => [o.id, o]));

  const allIds = new Set([...baseById.keys(), ...mineById.keys(), ...theirsById.keys()]);
  const merged: MapObject[] = [];
  let conflicts = 0;

  for (const id of allIds) {
    const b = baseById.get(id);
    const m = mineById.get(id);
    const t = theirsById.get(id);

    const mineChanged = !deepEqual(b, m);
    const theirsChanged = !deepEqual(b, t);

    if (!mineChanged && !theirsChanged) {
      // Untouched on both sides since base (including "never existed").
      if (t) merged.push(t);
      continue;
    }
    if (mineChanged && !theirsChanged) {
      if (m) merged.push(m); // add or edit; omission = delete
      continue;
    }
    if (!mineChanged && theirsChanged) {
      if (t) merged.push(t);
      continue;
    }

    // Both sides changed this id since base.
    if (!m && !t) continue; // deleted on both sides
    if (!m && t) {
      // Deleted by me, edited by them: edit wins.
      merged.push(t);
      continue;
    }
    if (m && !t) {
      // Edited by me, deleted by them: edit wins.
      merged.push(m);
      continue;
    }
    // Both edited (present on both sides, differ from base and from each
    // other, or added independently with the same id — practically
    // impossible given random ids). A genuine conflict: mine wins.
    if (m && t && !deepEqual(m, t)) conflicts++;
    if (m) merged.push(m);
  }

  return { merged, conflicts };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges a full saved-map snapshot. `stack` (layer order/opacity) and
 * `viewport` (camera position) are deliberately never merged — they're "what
 * I'm currently looking at" rather than shared content, so `mine`'s values
 * always win outright, same as if the map had never gone offline.
 */
export function mergeSavedMapData(
  base: SavedMapData,
  mine: SavedMapData,
  theirs: SavedMapData,
): { data: SavedMapData; conflicts: number } {
  const { merged, conflicts } = mergeObjects(base.objects, mine.objects, theirs.objects);
  return {
    data: { objects: merged, stack: mine.stack, viewport: mine.viewport },
    conflicts,
  };
}
