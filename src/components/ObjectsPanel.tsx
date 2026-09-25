"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistance } from "@/lib/geo";
import { parseImport, toGPX, toGeoJSON } from "@/lib/gpx";
import { mapRef } from "@/lib/mapRef";
import { iconPreviewDataUrl, MARKER_ICONS } from "@/lib/markerIcons";
import {
  DEFAULT_LINE_WIDTH,
  DEFAULT_MARKER_ICON,
  DEFAULT_MARKER_SIZE,
  DEFAULT_OPACITY,
  MAX_LINE_WIDTH,
  MAX_MARKER_SIZE,
  MIN_LINE_WIDTH,
  MIN_MARKER_SIZE,
  OBJECT_COLORS,
  objectBounds,
  objectLength,
  type MapObject,
} from "@/lib/objects";
import { mergeSavedMapData } from "@/lib/mapMerge";
import {
  cacheMapBody,
  cacheMapsList,
  syncOfflineMaps,
  getCachedMapBody,
  getCachedMapsList,
} from "@/lib/offlineMapsCache";
import { simplifyPath } from "@/lib/simplify";
import {
  createMap,
  deleteMap,
  getMap,
  listMaps,
  setMapPublic,
  updateMap,
  type SavedMapSummary,
} from "@/lib/savedMaps";
import { signOutAndClear, useMapStore } from "@/store/mapStore";

function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * A network-layer failure (fetch itself throwing) is a TypeError; an HTTP
 * error response is the plain Error api() in savedMaps.ts throws instead —
 * worth telling apart, since "you're offline" is a different, more
 * actionable message than "the server rejected this." (The list/load paths
 * below have their own offline fallback via offlineMapsCache.ts and don't
 * reach this helper in the offline case — this is for the failures that
 * genuinely have no local fallback: save, delete, sharing.)
 */
function describeApiError(action: string, err: unknown): string {
  if (err instanceof TypeError) {
    return `${action} — you're offline. This needs a connection; the map you already have open still works fine.`;
  }
  return `${action}: ${err instanceof Error ? err.message : String(err)}`;
}

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "map";
}

function zoomTo(obj: MapObject) {
  const map = mapRef.current;
  const b = objectBounds(obj);
  if (!map || !b) return;
  if (obj.kind === "marker") {
    map.flyTo({ center: obj.coords[0], zoom: Math.max(map.getZoom(), 13) });
  } else {
    map.fitBounds([b[0], b[1], b[2], b[3]], { padding: 80, maxZoom: 15 });
  }
}

type UpdateObjectFn = (
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

function IconPicker({ obj, updateObject }: { obj: MapObject; updateObject: UpdateObjectFn }) {
  const previews = useMemo(
    () => Object.fromEntries(MARKER_ICONS.map(({ id }) => [id, iconPreviewDataUrl(id, obj.color)])),
    [obj.color],
  );
  return (
    <div className="grid grid-cols-6 gap-1">
      {MARKER_ICONS.map(({ id, label }) => {
        const active = (obj.icon ?? DEFAULT_MARKER_ICON) === id;
        return (
          <button
            key={id}
            onClick={() => updateObject(obj.id, { icon: id })}
            title={label}
            aria-label={`Icon ${label}`}
            className={`flex items-center justify-center rounded border p-0.5 ${
              active ? "border-emerald-600 bg-emerald-50" : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- small client-generated data URL, not a static asset */}
            <img src={previews[id]} alt="" className="h-6 w-6" />
          </button>
        );
      })}
    </div>
  );
}

const SIMPLIFY_MIN_POINTS = 20;
const SIMPLIFY_MAX_TOLERANCE_M = 50;

/** Douglas-Peucker simplify with a live point-count readout. Simplifying
 * clears routing topology (waypoints/legs/snapped) — the result is a plain
 * polyline, same as an imported line; re-draw with snap for a fresh route. */
function SimplifyControl({ obj, updateObject }: { obj: MapObject; updateObject: UpdateObjectFn }) {
  const [original] = useState(obj.coords);
  const [tolerance, setTolerance] = useState(0);
  const previewCount = tolerance > 0 ? simplifyPath(original, tolerance).length : original.length;

  return (
    <div className="space-y-1 rounded-md border border-gray-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`simplify-${obj.id}`} className="text-xs text-gray-500">
          Simplify
        </label>
        <input
          id={`simplify-${obj.id}`}
          type="range"
          min={0}
          max={SIMPLIFY_MAX_TOLERANCE_M}
          value={tolerance}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTolerance(t);
            updateObject(obj.id, {
              coords: t > 0 ? simplifyPath(original, t) : original,
              waypoints: undefined,
              legs: undefined,
              snapped: undefined,
            });
          }}
          className="h-1 flex-1 accent-emerald-700"
          aria-label="Simplify tolerance"
        />
        <span className="w-12 text-right text-xs tabular-nums text-gray-500">{tolerance} m</span>
      </div>
      <p className="text-[10px] text-gray-400">
        {original.length} → {previewCount} points
        {tolerance > 0 && " · drops routing detail (re-draw with snap for a fresh route)"}
      </p>
    </div>
  );
}

function ObjectRow({ obj }: { obj: MapObject }) {
  const selected = useMapStore((s) => s.selectedId === obj.id);
  const splitting = useMapStore((s) => s.selectedId === obj.id && s.splitting);
  const { setSelected, setSplitting, updateObject, removeObject } = useMapStore();
  const len = objectLength(obj);
  // Avoid lineTopology()'s derive branch here — it allocates a full O(n) legs
  // array, and this runs on every render of every selected line row. The
  // waypoint count alone (or coords length, for topology-less imports) is
  // all this check needs.
  const canSplit = obj.kind === "line" && (obj.waypoints?.length ?? obj.coords.length) > 2;

  return (
    <li
      className={`rounded-md border ${
        selected ? "border-emerald-600 bg-emerald-50" : "border-gray-200 bg-white"
      }`}
    >
      <div
        className="flex cursor-pointer items-center gap-2 px-2 py-1.5"
        onClick={() => setSelected(selected ? null : obj.id)}
      >
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-white shadow"
          style={{ backgroundColor: obj.color }}
        />
        <span className="flex-1 truncate text-sm text-gray-900">{obj.title}</span>
        {len > 0 && (
          <span className="text-xs tabular-nums text-gray-500">
            {formatDistance(len)}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            zoomTo(obj);
          }}
          className="px-1 text-gray-400 hover:text-gray-800"
          title="Zoom to"
          aria-label={`Zoom to ${obj.title}`}
        >
          ⌖
        </button>
      </div>
      {selected && (
        <div className="space-y-2 border-t border-emerald-100 p-2">
          <input
            value={obj.title}
            onChange={(e) => updateObject(obj.id, { title: e.target.value })}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
            aria-label="Object title"
          />
          {(obj.kind === "line" || obj.kind === "polygon") && (
            <div className="flex items-center gap-2">
              <label htmlFor={`width-${obj.id}`} className="text-xs text-gray-500">
                {obj.kind === "polygon" ? "Outline" : "Width"}
              </label>
              <input
                id={`width-${obj.id}`}
                type="range"
                min={MIN_LINE_WIDTH}
                max={MAX_LINE_WIDTH}
                value={obj.width ?? DEFAULT_LINE_WIDTH}
                onChange={(e) => updateObject(obj.id, { width: Number(e.target.value) })}
                className="h-1 flex-1 accent-emerald-700"
                aria-label={obj.kind === "polygon" ? "Outline width" : "Line width"}
              />
              <span className="w-6 text-right text-xs tabular-nums text-gray-500">
                {obj.width ?? DEFAULT_LINE_WIDTH}
              </span>
            </div>
          )}
          {obj.kind === "marker" && (
            <>
              <IconPicker obj={obj} updateObject={updateObject} />
              <div className="flex items-center gap-2">
                <label htmlFor={`size-${obj.id}`} className="text-xs text-gray-500">
                  Size
                </label>
                <input
                  id={`size-${obj.id}`}
                  type="range"
                  min={MIN_MARKER_SIZE}
                  max={MAX_MARKER_SIZE}
                  step={0.5}
                  value={obj.size ?? DEFAULT_MARKER_SIZE}
                  onChange={(e) => updateObject(obj.id, { size: Number(e.target.value) })}
                  className="h-1 flex-1 accent-emerald-700"
                  aria-label="Marker size"
                />
                <span className="w-6 text-right text-xs tabular-nums text-gray-500">
                  {obj.size ?? DEFAULT_MARKER_SIZE}
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor={`opacity-${obj.id}`} className="text-xs text-gray-500">
              Opacity
            </label>
            <input
              id={`opacity-${obj.id}`}
              type="range"
              min={0}
              max={100}
              value={Math.round((obj.opacity ?? DEFAULT_OPACITY) * 100)}
              onChange={(e) => updateObject(obj.id, { opacity: Number(e.target.value) / 100 })}
              className="h-1 flex-1 accent-emerald-700"
              aria-label="Object opacity"
            />
            <span className="w-9 text-right text-xs tabular-nums text-gray-500">
              {Math.round((obj.opacity ?? DEFAULT_OPACITY) * 100)}%
            </span>
          </div>
          {obj.kind === "line" && obj.coords.length > SIMPLIFY_MIN_POINTS && (
            <SimplifyControl obj={obj} updateObject={updateObject} />
          )}
          <div className="flex items-center gap-1.5">
            {OBJECT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateObject(obj.id, { color: c })}
                className={`h-5 w-5 rounded-full border-2 ${
                  obj.color === c ? "border-gray-900" : "border-white"
                } shadow`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
            {canSplit && (
              <button
                onClick={() => setSplitting(!splitting)}
                title="Click a vertex on the map to split the line there"
                className={`ml-auto rounded px-2 py-0.5 text-xs ${
                  splitting
                    ? "bg-emerald-700 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {splitting ? "Click map to split…" : "Split"}
              </button>
            )}
            <button
              onClick={() => removeObject(obj.id)}
              className={`rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 ${
                canSplit ? "" : "ml-auto"
              }`}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function SavedMapRow({
  map,
  onLoad,
  onDelete,
  onTogglePublic,
}: {
  map: SavedMapSummary;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePublic: (id: string, makePublic: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isPublic = !!map.is_public;
  // Built from the current origin, not a hardcoded domain — works whether
  // this is opened via the custom domain or the workers.dev fallback.
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/m/${map.id}` : "";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Copy this link:", shareUrl);
    }
  }

  return (
    <li className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onLoad(map.id)}
          className="flex-1 truncate text-left text-sm text-gray-900 hover:text-emerald-800"
          title={new Date(map.updated_at * 1000).toLocaleString()}
        >
          {map.title}
        </button>
        <span className="text-xs text-gray-400">
          {new Date(map.updated_at * 1000).toLocaleDateString()}
        </span>
        <button
          onClick={() => onTogglePublic(map.id, !isPublic)}
          className={`px-1 ${isPublic ? "text-emerald-700 hover:text-emerald-900" : "text-gray-400 hover:text-gray-700"}`}
          title={isPublic ? "Public — anyone with the link can view. Click to make private." : "Make this map public (viewable via a share link, no sign-in)"}
          aria-label={isPublic ? `Stop sharing ${map.title}` : `Share ${map.title}`}
        >
          {isPublic ? "🔗" : "🔒"}
        </button>
        <button
          onClick={() => onDelete(map.id)}
          className="px-1 text-gray-400 hover:text-red-600"
          aria-label={`Delete ${map.title}`}
        >
          ✕
        </button>
      </div>
      {isPublic && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-gray-100 pt-1.5">
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 truncate rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600"
          />
          <button
            onClick={handleCopy}
            className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-800"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </li>
  );
}

export default function ObjectsPanel() {
  const objects = useMapStore((s) => s.objects);
  const currentMap = useMapStore((s) => s.currentMap);
  const dirty = useMapStore((s) => s.dirty);
  const authUser = useMapStore((s) => s.authUser);
  const autosaveEnabled = useMapStore((s) => s.autosaveEnabled);
  const setAutosaveEnabled = useMapStore((s) => s.setAutosaveEnabled);
  const { setTitle, newMap, loadMap, markSaved, importObjects, applyMergedObjects } = useMapStore();

  async function handleSignOut() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    await signOutAndClear();
  }

  const [open, setOpen] = useState(false);
  const [savedList, setSavedList] = useState<SavedMapSummary[] | null>(null);
  const [listIsOffline, setListIsOffline] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function showSyncNotice(conflicts: number) {
    setSyncNotice(
      conflicts === 1
        ? "Synced — 1 item had a conflicting edit made elsewhere; yours was kept."
        : `Synced — ${conflicts} items had conflicting edits made elsewhere; yours were kept.`,
    );
    setTimeout(() => setSyncNotice(null), 8000);
  }

  /**
   * Shared by the manual Save button and autosave. Reads fresh state at
   * call time (not a render closure) since autosave already needed that and
   * unifying the two save paths keeps there from being two save
   * implementations to keep in sync.
   *
   * For a brand-new map, just creates it. For an update, does a three-way
   * merge (mapMerge.ts) before saving: `base` is the last-synced snapshot
   * cached locally (offlineMapsCache.ts) when this map was last loaded or
   * saved, `mine` is this device's current objects/stack/viewport, `theirs`
   * is whatever the server holds right now — so an offline edit reconciles
   * with anything changed elsewhere instead of blindly overwriting it (the
   * old behavior, still what a brand-new map effectively gets since there's
   * nothing to merge against yet). Throws on failure, including offline —
   * callers decide whether that's alert-worthy or silent.
   */
  async function saveMap(): Promise<{ conflicts: number }> {
    const s = useMapStore.getState();
    const title = s.currentMap.title.trim() || "Untitled map";
    const mine = { objects: s.objects, stack: s.stack, viewport: s.viewport };

    if (!s.currentMap.id) {
      const { id } = await createMap(title, mine);
      cacheMapBody(id, title, mine, 0);
      markSaved(id);
      return { conflicts: 0 };
    }

    const id = s.currentMap.id;
    const theirs = await getMap(id); // throws (TypeError) if offline
    const cachedBase = getCachedMapBody(id);
    const base = cachedBase ? cachedBase.data : theirs.data;
    const { data: merged, conflicts } = mergeSavedMapData(base, mine, theirs.data);

    await updateMap(id, title, merged);
    cacheMapBody(id, title, merged, theirs.is_public);
    applyMergedObjects(merged.objects);
    markSaved(id);
    return { conflicts };
  }

  async function handleSave() {
    setBusy(true);
    try {
      const { conflicts } = await saveMap();
      setSavedList(null);
      if (conflicts > 0) showSyncNotice(conflicts);
    } catch (err) {
      alert(describeApiError("Save failed", err));
    } finally {
      setBusy(false);
    }
  }

  const AUTOSAVE_DEBOUNCE_MS = 3000;
  // Off by default (a checkbox, not a silent behavior change). Fires once
  // ~3s after an edit makes the map dirty. Silent on failure (console
  // only): an autosave shouldn't interrupt whatever the user's doing with
  // an alert() the way a manual Save click's failure should — but a real
  // merge conflict is a *successful* save, not a failure, so it still gets
  // the same visible notice a manual Save's conflict would.
  useEffect(() => {
    if (!autosaveEnabled || !dirty) return;
    const t = setTimeout(async () => {
      if (!useMapStore.getState().dirty) return; // saved via the manual button meanwhile
      try {
        const { conflicts } = await saveMap();
        setSavedList(null);
        if (conflicts > 0) showSyncNotice(conflicts);
      } catch (err) {
        console.warn("Autosave failed", err);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads fresh state at fire time; only dirty/autosaveEnabled should retrigger
  }, [autosaveEnabled, dirty]);

  // Mirror all saved maps for offline use once per app load (no-op offline).
  useEffect(() => {
    const st = useMapStore.getState();
    void syncOfflineMaps(st.dirty ? (st.currentMap.id ?? undefined) : undefined);
  }, []);

  async function handleOpenList() {
    if (savedList) {
      setSavedList(null);
      return;
    }
    setBusy(true);
    try {
      const list = await listMaps();
      cacheMapsList(list);
      setListIsOffline(false);
      setSavedList(list);
    } catch (err) {
      const cached = err instanceof TypeError ? getCachedMapsList() : null;
      if (cached) {
        setListIsOffline(true);
        setSavedList(cached);
      } else {
        alert(describeApiError("Couldn't list saved maps", err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(id: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setBusy(true);
    try {
      const saved = await getMap(id);
      cacheMapBody(saved.id, saved.title, saved.data, saved.is_public);
      loadMap(saved.id, saved.title, saved.data);
      const v = saved.data.viewport;
      mapRef.current?.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
      setSavedList(null);
    } catch (err) {
      const cached = err instanceof TypeError ? getCachedMapBody(id) : null;
      if (cached) {
        loadMap(cached.id, cached.title, cached.data);
        const v = cached.data.viewport;
        mapRef.current?.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
        setSavedList(null);
      } else if (err instanceof TypeError) {
        alert("This map isn't available offline — open it once while online first.");
      } else {
        alert(describeApiError("Load failed", err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSaved(id: string) {
    if (!confirm("Delete this saved map?")) return;
    try {
      await deleteMap(id);
      setSavedList((l) => l?.filter((m) => m.id !== id) ?? null);
      if (useMapStore.getState().currentMap.id === id) markSaved("");
    } catch (err) {
      alert(describeApiError("Delete failed", err));
    }
  }

  async function handleTogglePublic(id: string, makePublic: boolean) {
    try {
      await setMapPublic(id, makePublic);
      setSavedList(
        (l) => l?.map((m) => (m.id === id ? { ...m, is_public: makePublic ? 1 : 0 } : m)) ?? null,
      );
    } catch (err) {
      alert(describeApiError("Couldn't update sharing", err));
    }
  }

  function handleNew() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    newMap();
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      importObjects(parseImport(file.name, text, objects.length));
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const btn =
    "rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm border border-gray-200 hover:border-emerald-600 hover:text-emerald-800 disabled:opacity-40";

  return (
    <div className="absolute left-2 top-2 z-10 w-72 max-w-[calc(100vw-1rem)] select-none">
      {/* Was sm:top-14 on desktop (clearing the centered Toolbar/SearchBox
          row, which used to collide with this at ~950px wide) — moved back
          to top-2 per request. Tested at 700–1300px wide: the closed
          hamburger button never reaches the centered row. Opening this
          panel *and* LayerPanel *and* the search box at the same time at
          ~950px does still geometrically overlap the search row (confirmed)
          — fixed not by geometry but by giving that row z-20 (MapView.tsx)
          so the thing being actively typed into always renders on top and
          stays fully clickable, rather than getting partly covered by a
          static panel. See docs/PLAN.md, 2026-09-01. */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="mb-1 rounded-md bg-white/95 p-2 text-emerald-900 shadow hover:bg-white"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>
      {open && (
        <div className="max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto rounded-lg bg-gray-50/95 p-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-1.5">
            <input
              value={currentMap.title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm font-medium"
              aria-label="Map title"
            />
            {dirty && (
              <span title="Unsaved changes" className="text-lg leading-none text-amber-500">
                ●
              </span>
            )}
          </div>

          {syncNotice && (
            <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{syncNotice}</p>
          )}

          <label className="flex items-center gap-1.5 px-1 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={autosaveEnabled}
              onChange={(e) => setAutosaveEnabled(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Autosave (~3s after each change)
          </label>

          <div className="flex flex-wrap gap-1.5">
            <button className={btn} onClick={handleNew}>New</button>
            <button className={btn} onClick={handleOpenList} disabled={busy}>
              Open
            </button>
            <button className={btn} onClick={handleSave} disabled={busy}>
              Save
            </button>
            <button className={btn} onClick={() => fileInput.current?.click()}>
              Import
            </button>
            <button
              className={btn}
              onClick={() =>
                download(`${slug(currentMap.title)}.gpx`, "application/gpx+xml", toGPX(objects))
              }
              disabled={objects.length === 0}
            >
              GPX ↓
            </button>
            <button
              className={btn}
              onClick={() =>
                download(
                  `${slug(currentMap.title)}.geojson`,
                  "application/geo+json",
                  JSON.stringify(toGeoJSON(objects), null, 1),
                )
              }
              disabled={objects.length === 0}
            >
              GeoJSON ↓
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".gpx,.geojson,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />

          {savedList && (
            <div>
              <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Saved maps
              </h3>
              {listIsOffline && (
                <p className="px-1 pb-1 text-xs text-amber-600">
                  Offline — showing the last synced list; opening a map you&rsquo;ve loaded
                  here before still works.
                </p>
              )}
              {savedList.length === 0 && (
                <p className="px-1 text-sm text-gray-500">No saved maps yet.</p>
              )}
              <ul className="space-y-1">
                {savedList.map((m) => (
                  <SavedMapRow
                    key={m.id}
                    map={m}
                    onLoad={handleLoad}
                    onDelete={handleDeleteSaved}
                    onTogglePublic={handleTogglePublic}
                  />
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Objects
            </h3>
            {objects.length === 0 ? (
              <p className="px-1 text-sm text-gray-500">
                Nothing drawn yet — use the tools at the top of the map.
              </p>
            ) : (
              <ul className="space-y-1">
                {objects.map((obj) => (
                  <ObjectRow key={obj.id} obj={obj} />
                ))}
              </ul>
            )}
          </div>

          {authUser && (
            <div className="flex items-center justify-between border-t border-gray-200 px-1 pt-2 text-xs text-gray-500">
              <span className="truncate" title={authUser.email}>
                Signed in as {authUser.email}
              </span>
              <button onClick={handleSignOut} className="shrink-0 text-gray-400 hover:text-gray-700">
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
