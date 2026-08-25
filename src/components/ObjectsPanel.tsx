"use client";

import { useMemo, useRef, useState } from "react";
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
import { simplifyPath } from "@/lib/simplify";
import {
  createMap,
  deleteMap,
  getMap,
  listMaps,
  updateMap,
  type SavedMapSummary,
} from "@/lib/savedMaps";
import { useMapStore } from "@/store/mapStore";

function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const { setSelected, updateObject, removeObject } = useMapStore();
  const len = objectLength(obj);

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
            <button
              onClick={() => removeObject(obj.id)}
              className="ml-auto rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function ObjectsPanel() {
  const objects = useMapStore((s) => s.objects);
  const currentMap = useMapStore((s) => s.currentMap);
  const dirty = useMapStore((s) => s.dirty);
  const { setTitle, newMap, loadMap, markSaved, importObjects } = useMapStore();

  const [open, setOpen] = useState(false);
  const [savedList, setSavedList] = useState<SavedMapSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const snapshot = () => {
    const s = useMapStore.getState();
    return { objects: s.objects, stack: s.stack, viewport: s.viewport };
  };

  async function handleSave() {
    setBusy(true);
    try {
      const title = currentMap.title.trim() || "Untitled map";
      if (currentMap.id) {
        await updateMap(currentMap.id, title, snapshot());
        markSaved(currentMap.id);
      } else {
        const { id } = await createMap(title, snapshot());
        markSaved(id);
      }
      setSavedList(null);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenList() {
    if (savedList) {
      setSavedList(null);
      return;
    }
    setBusy(true);
    try {
      setSavedList(await listMaps());
    } catch (err) {
      alert(`Couldn't list maps: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(id: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setBusy(true);
    try {
      const saved = await getMap(id);
      loadMap(saved.id, saved.title, saved.data);
      const v = saved.data.viewport;
      mapRef.current?.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
      setSavedList(null);
    } catch (err) {
      alert(`Load failed: ${err instanceof Error ? err.message : err}`);
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
      alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
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
    <div className="absolute left-2 top-2 z-10 w-72 max-w-[calc(100vw-1rem)] select-none sm:top-14">
      {/* sm:top-14, not top-2: on desktop this clears the centered
          Toolbar/SearchBox row so an expanded panel can't overlap the map
          tools; on mobile the toolbar moves off to the right instead, so
          top-2 is free. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="mb-1 rounded-md bg-white/95 px-3 py-1.5 text-sm font-semibold text-emerald-900 shadow"
      >
        rexMaps {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto rounded-lg bg-gray-50/95 p-2 shadow-lg backdrop-blur sm:max-h-[calc(100dvh-8rem)]">
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
              {savedList.length === 0 && (
                <p className="px-1 text-sm text-gray-500">No saved maps yet.</p>
              )}
              <ul className="space-y-1">
                {savedList.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5"
                  >
                    <button
                      onClick={() => handleLoad(m.id)}
                      className="flex-1 truncate text-left text-sm text-gray-900 hover:text-emerald-800"
                      title={new Date(m.updated_at * 1000).toLocaleString()}
                    >
                      {m.title}
                    </button>
                    <span className="text-xs text-gray-400">
                      {new Date(m.updated_at * 1000).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleDeleteSaved(m.id)}
                      className="px-1 text-gray-400 hover:text-red-600"
                      aria-label={`Delete ${m.title}`}
                    >
                      ✕
                    </button>
                  </li>
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
        </div>
      )}
    </div>
  );
}
