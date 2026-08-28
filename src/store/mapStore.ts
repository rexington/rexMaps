import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LngLat } from "@/lib/geo";
import {
  legsToCoords,
  lineTopology,
  newObject,
  type MapObject,
} from "@/lib/objects";
import type { CustomOverlayDef } from "@/lib/layers/customOverlay";
import { layerDef } from "@/lib/layers/registry";
import { isVectorKind, type ActiveLayer } from "@/lib/layers/types";
import { routeLeg } from "@/lib/routing";
import {
  createCustomOverlay,
  deleteCustomOverlay,
  listCustomOverlays,
  type CustomOverlayInput,
} from "@/lib/customOverlaysApi";
import { fetchCurrentUser, signOut as signOutRequest, type SessionUser } from "@/lib/authClient";

export interface Viewport {
  lng: number;
  lat: number;
  zoom: number;
}

export type Tool = "select" | "marker" | "line" | "polygon" | "query";

export interface OfflinePackMeta {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  zMin: number;
  zMax: number;
  layerIds: string[];
  includeTerrain: boolean;
  tileCount: number;
  byteSize: number;
  createdAt: number;
}

export interface Draft {
  /** Points the user clicked. */
  waypoints: LngLat[];
  /** legs[i] connects waypoints[i]→waypoints[i+1] (endpoints included). */
  legs: LngLat[][];
  snapped: boolean[];
  cursor: LngLat | null;
  /** In-flight BRouter requests (drives the "routing…" hint). */
  pending: number;
  /**
   * Live routing preview: the snapped path from the last waypoint to
   * `previewFor`. Rendered instead of the straight dashed segment only while
   * the cursor is exactly at `previewFor` (see draftFeatureCollection), so a
   * stale preview is ignored rather than cleared on every mousemove.
   */
  previewLeg?: LngLat[] | null;
  previewFor?: LngLat | null;
}

interface MapStore {
  viewport: Viewport;
  /** Index 0 = bottom of the visual stack. */
  stack: ActiveLayer[];

  // Drawn objects
  objects: MapObject[];
  selectedId: string | null;
  tool: Tool;
  draft: Draft | null;
  /** Snap line legs to known trails/paths (BRouter) while drawing. */
  snapEnabled: boolean;

  /** Sentinel-2 layer options (lookback window + mosaic priority). */
  sentinel: { days: number; mode: "latest" | "clearest" };
  setSentinel: (patch: Partial<MapStore["sentinel"]>) => void;

  // Saved-map tracking
  currentMap: { id: string | null; title: string };
  dirty: boolean;

  // Offline areas (Stage 6b) — metadata only; tile bytes live in Cache Storage.
  offlinePacks: OfflinePackMeta[];
  addOfflinePack: (pack: OfflinePackMeta) => void;
  renameOfflinePack: (id: string, name: string) => void;
  /** Removes the pack from this list. Doesn't reclaim its tiles — see
   * clearOfflineTiles() in lib/offline.ts, since tiles may be shared with
   * other overlapping packs. */
  removeOfflinePack: (id: string) => void;
  clearOfflinePacks: () => void;

  // Sign-in state (see src/lib/auth.ts / authClient.ts). Not persisted —
  // rechecked on every load via loadAuthUser(), since the source of truth is
  // the session cookie, not anything the client should cache across visits.
  authUser: SessionUser | null;
  /** True once the initial /api/auth/me check has resolved — lets AuthGate
   * distinguish "still checking" from "genuinely signed out". */
  authChecked: boolean;

  // Custom overlays (user-supplied WFS catalogs, e.g. a SOTA summits server).
  // Private per account, server-backed (see src/lib/customOverlaysApi.ts) —
  // NOT part of this store's localStorage persistence. Populated once by
  // loadCustomOverlays() (called from MapView's init effect); mutated via
  // the exported addCustomOverlay/removeCustomOverlayDef functions below,
  // which hit the API first and only update local state on success.
  customOverlays: CustomOverlayDef[];
  /** True once the initial server fetch has completed (success or not) —
   * lets the UI distinguish "still loading" from "genuinely zero overlays". */
  customOverlaysLoaded: boolean;
  /** Runtime-only fetch status per overlay id, keyed for LayerPanel display. */
  customOverlayStatus: Record<string, { loading: boolean; error: string | null }>;
  setCustomOverlayStatus: (id: string, status: { loading: boolean; error: string | null }) => void;

  setViewport: (v: Viewport) => void;

  // Layer stack
  addLayer: (defId: string) => void;
  removeLayer: (defId: string) => void;
  setOpacity: (defId: string, opacity: number) => void;
  toggleVisible: (defId: string) => void;
  /** Move stack[from] to index `to` (stack indices, not display indices). */
  moveLayer: (from: number, to: number) => void;

  // Drawing
  setTool: (tool: Tool) => void;
  toggleSnap: () => void;
  addMarker: (pt: LngLat) => void;
  draftCursor: (pt: LngLat | null) => void;
  /** Remove the last placed point (and its leg) while drawing. */
  draftUndo: () => void;
  draftFinish: () => void;
  draftCancel: () => void;

  // Objects
  setSelected: (id: string | null) => void;
  /** True while waiting for a click on one of the selected line's vertices
   * to split it there (see splitObjectAtVertex). Always false unless a line
   * is selected — cleared automatically on tool change or reselection. */
  splitting: boolean;
  setSplitting: (splitting: boolean) => void;
  updateObject: (
    id: string,
    patch: Partial<
      Pick<
        MapObject,
        | "title"
        | "color"
        | "width"
        | "opacity"
        | "icon"
        | "size"
        | "coords"
        | "waypoints"
        | "legs"
        | "snapped"
      >
    >,
  ) => void;
  removeObject: (id: string) => void;
  importObjects: (objects: MapObject[]) => void;

  // Saved maps
  setTitle: (title: string) => void;
  newMap: () => void;
  loadMap: (
    id: string,
    title: string,
    data: { objects: MapObject[]; stack: ActiveLayer[]; viewport: Viewport },
  ) => void;
  markSaved: (id: string) => void;
}

const DEFAULT_STACK: ActiveLayer[] = [
  { defId: "ofm-liberty", visible: true, opacity: 1 },
  { defId: "esri-hillshade", visible: true, opacity: 0.25 },
];

const samePoint = (a: LngLat, b: LngLat) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Drop consecutive near-duplicate points (double-click finish artifacts). */
function dedupe(coords: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const c of coords) {
    if (!out.length || !samePoint(out[out.length - 1], c)) out.push(c);
  }
  return out;
}

/** Bumped on finish/cancel/tool-change so stale async leg results are dropped. */
let draftRev = 0;

export const useMapStore = create<MapStore>()(
  persist(
    (set) => ({
      viewport: { lng: -98.5, lat: 39.8, zoom: 4 },
      stack: DEFAULT_STACK,
      objects: [],
      selectedId: null,
      splitting: false,
      tool: "select",
      draft: null,
      snapEnabled: true,
      sentinel: { days: 7, mode: "latest" },
      currentMap: { id: null, title: "Untitled map" },
      dirty: false,
      offlinePacks: [],
      authUser: null,
      authChecked: false,
      customOverlays: [],
      customOverlaysLoaded: false,
      customOverlayStatus: {},

      setSentinel: (patch) =>
        set((s) => ({ sentinel: { ...s.sentinel, ...patch } })),

      addOfflinePack: (pack) =>
        set((s) => ({ offlinePacks: [...s.offlinePacks, pack] })),
      renameOfflinePack: (id, name) =>
        set((s) => ({
          offlinePacks: s.offlinePacks.map((p) => (p.id === id ? { ...p, name } : p)),
        })),
      removeOfflinePack: (id) =>
        set((s) => ({ offlinePacks: s.offlinePacks.filter((p) => p.id !== id) })),
      clearOfflinePacks: () => set({ offlinePacks: [] }),

      setCustomOverlayStatus: (id, status) =>
        set((s) => ({ customOverlayStatus: { ...s.customOverlayStatus, [id]: status } })),

      setViewport: (viewport) => set({ viewport }),

      addLayer: (defId) =>
        set((s) => {
          if (s.stack.some((l) => l.defId === defId)) return s;
          const def = layerDef(defId);
          if (!def) {
            // Not a static registry layer — maybe a user-defined custom overlay.
            if (!s.customOverlays.some((c) => c.id === defId)) return s;
            return {
              stack: [...s.stack, { defId, visible: true, opacity: 1 }],
              dirty: true,
            };
          }
          // Only one vector layer at a time (single glyphs URL per style).
          const stack = isVectorKind(def)
            ? s.stack.filter((l) => {
                const d = layerDef(l.defId);
                return !d || !isVectorKind(d);
              })
            : [...s.stack];
          // Vector layers are backgrounds by nature — insert at the bottom;
          // rasters go on top where the user can immediately see them.
          const opacity = def.defaultOpacity ?? 1;
          if (isVectorKind(def)) {
            stack.unshift({ defId, visible: true, opacity });
          } else {
            stack.push({ defId, visible: true, opacity });
          }
          return { stack, dirty: true };
        }),

      removeLayer: (defId) =>
        set((s) => ({
          stack: s.stack.filter((l) => l.defId !== defId),
          dirty: true,
        })),

      setOpacity: (defId, opacity) =>
        set((s) => ({
          stack: s.stack.map((l) => (l.defId === defId ? { ...l, opacity } : l)),
          dirty: true,
        })),

      toggleVisible: (defId) =>
        set((s) => ({
          stack: s.stack.map((l) =>
            l.defId === defId ? { ...l, visible: !l.visible } : l,
          ),
          dirty: true,
        })),

      moveLayer: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || from >= s.stack.length) return s;
          const stack = [...s.stack];
          const [moved] = stack.splice(from, 1);
          stack.splice(Math.max(0, Math.min(to, stack.length)), 0, moved);
          return { stack, dirty: true };
        }),

      setTool: (tool) => {
        draftRev++;
        set({ tool, draft: null, splitting: false });
      },

      toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

      addMarker: (pt) =>
        set((s) => {
          const obj = newObject("marker", [pt], s.objects.length);
          return {
            objects: [...s.objects, obj],
            selectedId: obj.id,
            dirty: true,
          };
        }),

      draftCursor: (cursor) =>
        set((s) => (s.draft ? { draft: { ...s.draft, cursor } } : s)),

      draftUndo: () =>
        set((s) => {
          if (!s.draft || s.draft.waypoints.length === 0) return s;
          const waypoints = s.draft.waypoints.slice(0, -1);
          // Last point removed: back to an empty draft, tool stays active.
          if (waypoints.length === 0) return { draft: null };
          return {
            draft: {
              ...s.draft,
              waypoints,
              legs: s.draft.legs.slice(0, -1),
              snapped: s.draft.snapped.slice(0, -1),
              // Preview routed from the removed waypoint is stale.
              previewLeg: null,
              previewFor: null,
            },
          };
        }),

      draftFinish: () => {
        draftRev++;
        set((s) => {
          if (!s.draft || (s.tool !== "line" && s.tool !== "polygon")) return s;

          // Drop a trailing duplicate waypoint (double-click artifact) + its leg.
          let { waypoints, legs, snapped } = s.draft;
          while (
            waypoints.length >= 2 &&
            samePoint(waypoints[waypoints.length - 1], waypoints[waypoints.length - 2])
          ) {
            waypoints = waypoints.slice(0, -1);
            legs = legs.slice(0, -1);
            snapped = snapped.slice(0, -1);
          }

          const min = s.tool === "line" ? 2 : 3;
          if (waypoints.length < min) return { draft: null, tool: "select" };

          const obj = newObject(s.tool, dedupe(waypoints), s.objects.length);
          if (s.tool === "line") {
            obj.coords = dedupe(legsToCoords(legs));
            obj.waypoints = waypoints;
            obj.legs = legs;
            obj.snapped = snapped;
          }
          return {
            objects: [...s.objects, obj],
            selectedId: obj.id,
            draft: null,
            tool: "select",
            dirty: true,
          };
        });
      },

      draftCancel: () => {
        draftRev++;
        set({ draft: null, tool: "select" });
      },

      setSelected: (selectedId) => set({ selectedId, splitting: false }),
      setSplitting: (splitting) => set({ splitting }),

      updateObject: (id, patch) =>
        set((s) => ({
          objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          dirty: true,
        })),

      removeObject: (id) =>
        set((s) => ({
          objects: s.objects.filter((o) => o.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
          splitting: s.selectedId === id ? false : s.splitting,
          dirty: true,
        })),

      importObjects: (objects) =>
        set((s) => ({ objects: [...s.objects, ...objects], dirty: true })),

      setTitle: (title) =>
        set((s) => ({ currentMap: { ...s.currentMap, title }, dirty: true })),

      newMap: () =>
        set({
          objects: [],
          selectedId: null,
          draft: null,
          tool: "select",
          currentMap: { id: null, title: "Untitled map" },
          dirty: false,
        }),

      loadMap: (id, title, data) =>
        set({
          objects: data.objects,
          stack: data.stack,
          viewport: data.viewport,
          selectedId: null,
          draft: null,
          tool: "select",
          currentMap: { id, title },
          dirty: false,
        }),

      markSaved: (id) =>
        set((s) => ({ currentMap: { ...s.currentMap, id }, dirty: false })),
    }),
    {
      name: "rexmaps-state",
      version: 2,
      partialize: (s) => ({
        viewport: s.viewport,
        stack: s.stack,
        objects: s.objects,
        snapEnabled: s.snapEnabled,
        sentinel: s.sentinel,
        currentMap: s.currentMap,
        dirty: s.dirty,
        offlinePacks: s.offlinePacks,
      }),
      migrate: (persisted) => persisted as MapStore,
    },
  ),
);

/** Small cache of routed legs, keyed by exact endpoints. Shared between the
 * live preview and leg commits, so clicking where the preview already routed
 * costs zero extra requests and snaps instantly. */
const legCache = new Map<string, LngLat[]>();
const legKey = (from: LngLat, to: LngLat) => `${from[0]},${from[1]}|${to[0]},${to[1]}`;
function cacheLeg(from: LngLat, to: LngLat, path: LngLat[]) {
  if (legCache.size >= 200) {
    const oldest = legCache.keys().next().value;
    if (oldest !== undefined) legCache.delete(oldest);
  }
  legCache.set(legKey(from, to), path);
}

/**
 * Append a clicked point to the draft. Line legs snap to trails via BRouter
 * when snap is on: the leg starts straight and is replaced in place when the
 * routed path arrives (stale responses are dropped via draftRev).
 */
export async function appendDraftPoint(pt: LngLat) {
  const s = useMapStore.getState();
  if (s.tool !== "line" && s.tool !== "polygon") return;
  const draft: Draft = s.draft ?? {
    waypoints: [],
    legs: [],
    snapped: [],
    cursor: null,
    pending: 0,
  };
  const prev = draft.waypoints[draft.waypoints.length - 1] as LngLat | undefined;
  const waypoints = [...draft.waypoints, pt];
  if (!prev) {
    useMapStore.setState({ draft: { ...draft, waypoints } });
    return;
  }

  const wantSnap = s.tool === "line" && s.snapEnabled && !samePoint(prev, pt);
  const legIdx = waypoints.length - 2;

  // The live preview usually routed this exact leg already — commit it as-is.
  const cached = wantSnap ? legCache.get(legKey(prev, pt)) : undefined;
  useMapStore.setState({
    draft: {
      ...draft,
      waypoints,
      legs: [...draft.legs, cached ?? [prev, pt]],
      snapped: [...draft.snapped, !!cached],
      pending: draft.pending + (wantSnap && !cached ? 1 : 0),
      previewLeg: null,
      previewFor: null,
    },
  });
  if (!wantSnap || cached) return;

  const myRev = draftRev;
  let routed: LngLat[] | null = null;
  try {
    routed = await routeLeg(prev, pt);
    cacheLeg(prev, pt, routed);
  } catch (err) {
    console.warn("snap routing failed; keeping straight leg", err);
  }
  const cur = useMapStore.getState().draft;
  if (myRev !== draftRev || !cur) return;
  // The leg may have been undone while routing — still settle the counter.
  if (cur.legs.length <= legIdx) {
    useMapStore.setState({
      draft: { ...cur, pending: Math.max(0, cur.pending - 1) },
    });
    return;
  }
  const legs = [...cur.legs];
  const snapped = [...cur.snapped];
  if (routed) {
    legs[legIdx] = routed;
    snapped[legIdx] = true;
  }
  useMapStore.setState({
    draft: { ...cur, legs, snapped, pending: cur.pending - 1 },
  });
}

/**
 * Live snap preview: after the cursor rests for a beat, route from the last
 * waypoint to it and show the result as the dashed preview segment.
 * Debounced + aborting, so at most ~1 in-flight request regardless of mouse
 * activity — a light touch on the public BRouter instance.
 */
const PREVIEW_DEBOUNCE_MS = 175;
const PREVIEW_MAX_KM = 100;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewAbort: AbortController | null = null;

export function scheduleDraftPreview() {
  const s = useMapStore.getState();
  if (s.tool !== "line" || !s.snapEnabled || !s.draft?.cursor) return;
  const from = s.draft.waypoints[s.draft.waypoints.length - 1] as LngLat | undefined;
  if (!from) return;
  const to = s.draft.cursor;
  if (samePoint(from, to)) return;

  // Cache hit: show it immediately, no timer.
  const cached = legCache.get(legKey(from, to));
  if (cached) {
    useMapStore.setState({
      draft: { ...s.draft, previewLeg: cached, previewFor: to },
    });
    return;
  }

  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    previewTimer = null;
    const cur = useMapStore.getState();
    const draft = cur.draft;
    if (cur.tool !== "line" || !cur.snapEnabled || !draft?.cursor) return;
    const start = draft.waypoints[draft.waypoints.length - 1] as LngLat | undefined;
    const target = draft.cursor;
    if (!start || !samePoint(target, to)) return; // cursor moved on; a newer timer owns it
    // Keep preview routing to sane distances.
    const [dx, dy] = [Math.abs(start[0] - target[0]), Math.abs(start[1] - target[1])];
    if (Math.max(dx, dy) * 111 > PREVIEW_MAX_KM) return;

    previewAbort?.abort();
    const abort = new AbortController();
    previewAbort = abort;
    const myRev = draftRev;
    try {
      const routed = await routeLeg(start, target, abort.signal);
      cacheLeg(start, target, routed);
      const now = useMapStore.getState();
      if (
        myRev !== draftRev ||
        !now.draft?.cursor ||
        !samePoint(now.draft.cursor, target)
      )
        return;
      useMapStore.setState({
        draft: { ...now.draft, previewLeg: routed, previewFor: target },
      });
    } catch {
      // Preview is best-effort: aborted or unroutable → straight dash stays.
    }
  }, PREVIEW_DEBOUNCE_MS);
}

/** Live vertex drag: move a handle, adjacent legs collapse to straight lines. */
export function moveObjectVertex(id: string, idx: number, pt: LngLat) {
  const s = useMapStore.getState();
  const obj = s.objects.find((o) => o.id === id);
  if (!obj) return;

  let patch: Partial<MapObject>;
  if (obj.kind === "marker") {
    patch = { coords: [pt] };
  } else if (obj.kind === "polygon") {
    const coords = [...obj.coords];
    coords[idx] = pt;
    patch = { coords };
  } else {
    const { waypoints, legs, snapped } = lineTopology(obj);
    const wps = [...waypoints];
    const lgs = legs.map((l) => [...l]);
    wps[idx] = pt;
    if (idx > 0) lgs[idx - 1] = [wps[idx - 1], pt];
    if (idx < wps.length - 1) lgs[idx] = [pt, wps[idx + 1]];
    patch = {
      coords: legsToCoords(lgs),
      waypoints: wps,
      legs: lgs,
      snapped: [...snapped],
    };
  }
  s.updateObject(id, patch);
}

/** After a vertex drag ends: re-route the adjacent legs that were snapped. */
export async function refitObjectVertex(id: string, idx: number) {
  const s = useMapStore.getState();
  const obj = s.objects.find((o) => o.id === id);
  if (!obj || obj.kind !== "line") return;
  const topo = lineTopology(obj);

  const legIdxs = [idx - 1, idx].filter(
    (i) => i >= 0 && i < topo.legs.length && topo.snapped[i],
  );
  for (const i of legIdxs) {
    const [from, to] = [topo.waypoints[i], topo.waypoints[i + 1]];
    try {
      const routed = await routeLeg(from, to);
      const cur = useMapStore.getState().objects.find((o) => o.id === id);
      if (!cur || cur.kind !== "line") return;
      const t = lineTopology(cur);
      // Skip if the waypoints moved again while we were routing.
      if (!samePoint(t.waypoints[i], from) || !samePoint(t.waypoints[i + 1], to)) continue;
      const legs = t.legs.map((l) => [...l]);
      legs[i] = routed;
      useMapStore.getState().updateObject(id, {
        coords: legsToCoords(legs),
        waypoints: t.waypoints,
        legs,
        snapped: t.snapped,
      });
    } catch (err) {
      console.warn("re-route after vertex edit failed; leg stays straight", err);
    }
  }
}

/**
 * Splits a line into two line objects at one of its waypoints — e.g. an
 * out-and-back import can be trimmed to just the outbound half by splitting
 * at the turnaround, then deleting the unwanted half with the normal object
 * delete. A no-op at either endpoint (nothing to split there). Both new
 * objects always carry explicit topology (waypoints/legs/snapped), even if
 * the original didn't (a plain import) — lineTopology() derives the same
 * shape on the fly today, so this changes nothing about how either half
 * renders or re-routes, just makes it permanent.
 */
export function splitObjectAtVertex(id: string, idx: number) {
  const obj = useMapStore.getState().objects.find((o) => o.id === id);
  if (!obj || obj.kind !== "line") return;
  const topo = lineTopology(obj);
  if (idx <= 0 || idx >= topo.waypoints.length - 1) return;

  const firstLegs = topo.legs.slice(0, idx);
  const secondLegs = topo.legs.slice(idx);
  // Keep the original title on the first half, not both — split-then-
  // delete-the-other-half is the expected workflow (e.g. trimming an
  // out-and-back to one direction), and a lone "Trail (1)" left behind
  // reads as if a sibling still exists.
  const first: MapObject = {
    ...obj,
    id: crypto.randomUUID(),
    waypoints: topo.waypoints.slice(0, idx + 1),
    legs: firstLegs,
    snapped: topo.snapped.slice(0, idx),
    coords: legsToCoords(firstLegs),
  };
  const second: MapObject = {
    ...obj,
    id: crypto.randomUUID(),
    title: `${obj.title} (2)`,
    waypoints: topo.waypoints.slice(idx),
    legs: secondLegs,
    snapped: topo.snapped.slice(idx),
    coords: legsToCoords(secondLegs),
  };

  useMapStore.setState((s) => ({
    objects: s.objects.flatMap((o) => (o.id === id ? [first, second] : [o])),
    selectedId: first.id,
    splitting: false,
    dirty: true,
  }));
}

/** Checks the session cookie against the server. Called once from AuthGate
 * on mount — the only way authUser gets populated, since sign-in state is
 * deliberately never persisted locally. */
export async function loadAuthUser() {
  const user = await fetchCurrentUser();
  useMapStore.setState({ authUser: user, authChecked: true });
}

export async function signOutAndClear() {
  await signOutRequest();
  useMapStore.setState({ authUser: null });
}

/** Fetches this account's custom overlays from the server. Called once from
 * MapView's init effect — not persisted locally, so this is the only way
 * customOverlays gets populated after a page load. */
export async function loadCustomOverlays() {
  try {
    const overlays = await listCustomOverlays();
    useMapStore.setState({ customOverlays: overlays, customOverlaysLoaded: true });
  } catch (err) {
    console.warn("failed to load custom overlays", err);
    useMapStore.setState({ customOverlaysLoaded: true });
  }
}

/** Creates an overlay on the server, then adds it (and activates it) locally
 * on success. Throws on failure — callers show the error inline. */
export async function addCustomOverlay(input: CustomOverlayInput): Promise<CustomOverlayDef> {
  const created = await createCustomOverlay(input);
  useMapStore.setState((s) => ({
    customOverlays: [...s.customOverlays, created],
    stack: [...s.stack, { defId: created.id, visible: true, opacity: 1 }],
    dirty: true,
  }));
  return created;
}

/** Deletes an overlay on the server, then forgets it locally on success
 * (not just hides it — see removeLayer for that). Local state — including
 * removing it from `stack` — only changes after the API call succeeds, so a
 * failed request never leaves the UI out of sync with the server. */
export async function removeCustomOverlayDef(id: string): Promise<void> {
  await deleteCustomOverlay(id);
  useMapStore.setState((s) => ({
    customOverlays: s.customOverlays.filter((c) => c.id !== id),
    stack: s.stack.filter((l) => l.defId !== id),
    dirty: true,
  }));
}
