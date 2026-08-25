"use client";

import { useEffect, useMemo, useState } from "react";
import { mapRef } from "@/lib/mapRef";
import {
  clearOfflineTiles,
  downloadArea,
  estimateDownload,
  offlineEligibleLayers,
} from "@/lib/offline";
import { useMapStore, type OfflinePackMeta } from "@/store/mapStore";

const ZOOM_PRESETS = [
  { label: "Overview (+1 zoom)", extra: 1 },
  { label: "Standard (+3 zoom)", extra: 3 },
  { label: "Detailed (+5 zoom)", extra: 5 },
];

const WARN_TILES = 4000;

const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function currentBboxAndZoom(zoomExtra: number) {
  const map = mapRef.current;
  if (!map) return null;
  const b = map.getBounds();
  const bbox: [number, number, number, number] = [
    b.getWest(),
    b.getSouth(),
    b.getEast(),
    b.getNorth(),
  ];
  const z = Math.floor(map.getZoom());
  return { bbox, zMin: Math.max(0, z - 1), zMax: Math.min(19, z + zoomExtra) };
}

export default function OfflineSection() {
  const [open, setOpen] = useState(false);
  const [forming, setForming] = useState(false);
  const [preset, setPreset] = useState(1);
  const [layerIds, setLayerIds] = useState<string[]>([]);
  const [includeTerrain, setIncludeTerrain] = useState(true);
  const [estimate, setEstimate] = useState<{ tiles: number; approxMB: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);

  const stack = useMapStore((s) => s.stack);
  const packs = useMapStore((s) => s.offlinePacks);
  const { addOfflinePack, renameOfflinePack, removeOfflinePack, clearOfflinePacks } =
    useMapStore();

  const eligible = useMemo(() => offlineEligibleLayers(), []);

  // Opening the form: seed the checkboxes from whatever's currently
  // active+visible, right in the click handler (not an effect — this is a
  // one-time default the user is then free to edit, not a sync-on-change).
  function openForm() {
    const activeIds = stack.filter((l) => l.visible).map((l) => l.defId);
    setLayerIds(eligible.filter((d) => activeIds.includes(d.id)).map((d) => d.id));
    setForming(true);
  }

  // Debounced re-estimate whenever the form options change.
  useEffect(() => {
    if (!forming) return;
    const ctx = currentBboxAndZoom(ZOOM_PRESETS[preset].extra);
    if (!ctx || layerIds.length === 0) return; // stale estimate stays hidden — see render guard below
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const est = await estimateDownload({ ...ctx, layerIds, includeTerrain });
        if (!cancelled) setEstimate(est);
      } catch {
        if (!cancelled) setEstimate(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [forming, preset, layerIds, includeTerrain]);

  async function handleDownload() {
    const ctx = currentBboxAndZoom(ZOOM_PRESETS[preset].extra);
    if (!ctx || layerIds.length === 0) return;
    setError(null);
    setProgress({ done: 0, total: estimate?.tiles ?? 0 });
    const controller = new AbortController();
    setAbort(controller);
    try {
      const result = await downloadArea({
        ...ctx,
        layerIds,
        includeTerrain,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      addOfflinePack({
        id: crypto.randomUUID(),
        name: `Area ${packs.length + 1}`,
        bbox: ctx.bbox,
        zMin: ctx.zMin,
        zMax: ctx.zMax,
        layerIds,
        includeTerrain,
        tileCount: result.tileCount,
        byteSize: result.byteSize,
        createdAt: Date.now(),
      });
      setForming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      setAbort(null);
    }
  }

  async function handleClearAll() {
    if (!confirm(`Delete all ${packs.length} offline area(s) and free their storage?`)) return;
    await clearOfflineTiles();
    clearOfflinePacks();
  }

  const chk = "h-3.5 w-3.5 accent-emerald-700";

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-1 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        Offline areas {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="space-y-2">
          {!forming && (
            <button
              onClick={openForm}
              className="w-full rounded-md border border-dashed border-gray-300 bg-white px-2 py-1.5 text-left text-sm text-gray-700 hover:border-emerald-600 hover:text-emerald-800"
            >
              + Download this area
            </button>
          )}
          {forming && (
            <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2">
              <p className="text-xs text-gray-500">
                Downloads what&apos;s currently on screen — pan/zoom the map first, then
                come back here.
              </p>
              <select
                value={preset}
                onChange={(e) => setPreset(Number(e.target.value))}
                className="w-full rounded border border-gray-300 bg-white px-1 py-1 text-xs text-gray-700"
                aria-label="Offline zoom depth"
              >
                {ZOOM_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
              <div className="space-y-1">
                {eligible.map((def) => (
                  <label key={def.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      className={chk}
                      checked={layerIds.includes(def.id)}
                      onChange={(e) =>
                        setLayerIds((ids) =>
                          e.target.checked
                            ? [...ids, def.id]
                            : ids.filter((id) => id !== def.id),
                        )
                      }
                    />
                    {def.name}
                  </label>
                ))}
                <label className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className={chk}
                    checked={includeTerrain}
                    onChange={(e) => setIncludeTerrain(e.target.checked)}
                  />
                  Terrain (elevation profiles + slope shading, offline)
                </label>
              </div>

              {estimate && layerIds.length > 0 && (
                <p
                  className={`text-xs ${estimate.tiles > WARN_TILES ? "text-amber-600" : "text-gray-500"}`}
                >
                  ~{estimate.tiles.toLocaleString()} tiles, ~{estimate.approxMB.toFixed(0)} MB
                  {estimate.tiles > WARN_TILES &&
                    " — that's a lot; consider a smaller area or shallower zoom"}
                </p>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}

              {progress ? (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full bg-emerald-600 transition-all"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {progress.done} / {progress.total}
                    </span>
                    <button onClick={() => abort?.abort()} className="text-red-600 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={handleDownload}
                    disabled={layerIds.length === 0}
                    className="flex-1 rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setForming(false)}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {packs.length > 0 && (
            <ul className="space-y-1">
              {packs.map((p) => (
                <PackRow
                  key={p.id}
                  pack={p}
                  onRename={renameOfflinePack}
                  onRemove={removeOfflinePack}
                />
              ))}
            </ul>
          )}
          {packs.length > 0 && (
            <button
              onClick={handleClearAll}
              className="w-full text-center text-xs text-gray-400 hover:text-red-600"
            >
              Clear all offline data
            </button>
          )}
          <p className="text-[10px] text-gray-400">
            On iPhone/iPad, add rexMaps to your Home Screen — Safari can quietly evict
            offline data from an ordinary browser tab after about a week unused.
          </p>
        </div>
      )}
    </div>
  );
}

function PackRow({
  pack,
  onRename,
  onRemove,
}: {
  pack: OfflinePackMeta;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="rounded-md border border-gray-200 bg-white px-2 py-1.5">
      <div className="flex items-center gap-2">
        <input
          value={pack.name}
          onChange={(e) => onRename(pack.id, e.target.value)}
          className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 text-xs text-gray-800 hover:border-gray-200 focus:border-gray-300 focus:bg-white"
          aria-label="Offline area name"
        />
        <button
          onClick={() => onRemove(pack.id)}
          className="px-1 text-gray-400 hover:text-red-600"
          aria-label={`Remove ${pack.name} from the list`}
          title="Remove from list (use Clear all offline data to free storage)"
        >
          ✕
        </button>
      </div>
      <p className="px-1 text-[10px] text-gray-400">
        z{pack.zMin}–{pack.zMax} · {pack.layerIds.length} layer
        {pack.layerIds.length === 1 ? "" : "s"}
        {pack.includeTerrain && " + terrain"} · {formatMB(pack.byteSize)}
      </p>
    </li>
  );
}
