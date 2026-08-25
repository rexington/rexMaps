"use client";

import { useState } from "react";
import { OBJECT_COLORS } from "@/lib/objects";
import { useMapStore } from "@/store/mapStore";

export default function CustomOverlaySection() {
  const [open, setOpen] = useState(false);
  const [forming, setForming] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [typeName, setTypeName] = useState("");
  const [labelField, setLabelField] = useState("");
  const [color, setColor] = useState<string>(OBJECT_COLORS[4]);
  const [formError, setFormError] = useState<string | null>(null);

  const stack = useMapStore((s) => s.stack);
  const customOverlays = useMapStore((s) => s.customOverlays);
  const { addLayer, addCustomOverlay, removeCustomOverlayDef } = useMapStore();

  const notActive = customOverlays.filter((c) => !stack.some((l) => l.defId === c.id));

  function reset() {
    setName("");
    setUrl("");
    setTypeName("");
    setLabelField("");
    setFormError(null);
    setForming(false);
  }

  function submit() {
    if (!name.trim() || !url.trim() || !typeName.trim()) {
      setFormError("Name, URL, and type name are all required.");
      return;
    }
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "https:") {
        setFormError("Use an https:// URL.");
        return;
      }
    } catch {
      setFormError("That doesn't look like a valid URL.");
      return;
    }
    addCustomOverlay({
      name: name.trim(),
      url: url.trim(),
      typeName: typeName.trim(),
      color,
      labelField: labelField.trim() || undefined,
    });
    reset();
  }

  const input = "w-full rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-800";

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-1 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        Custom overlays {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="space-y-2">
          <p className="px-1 text-[10px] text-gray-400">
            Point rexMaps at a WFS server that publishes a catalog of places — e.g. a
            summit or hut database. Queried live for the current view; not included in
            offline downloads.
          </p>

          {!forming && (
            <button
              onClick={() => setForming(true)}
              className="w-full rounded-md border border-dashed border-gray-300 bg-white px-2 py-1.5 text-left text-sm text-gray-700 hover:border-emerald-600 hover:text-emerald-800"
            >
              + Add custom overlay
            </button>
          )}

          {forming && (
            <div className="space-y-1.5 rounded-md border border-gray-200 bg-white p-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. SOTA summits)"
                className={input}
                aria-label="Overlay name"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="WFS URL (e.g. https://host/geoserver/wfs)"
                className={input}
                aria-label="WFS URL"
              />
              <input
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
                placeholder="Type name (WFS TYPENAMES)"
                className={input}
                aria-label="WFS type name"
              />
              <input
                value={labelField}
                onChange={(e) => setLabelField(e.target.value)}
                placeholder="Label field (optional, e.g. name)"
                className={input}
                aria-label="Label field"
              />
              <div className="flex items-center gap-1 px-0.5">
                {OBJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{ background: c }}
                    className={`h-5 w-5 rounded-full border-2 ${
                      color === c ? "border-gray-800" : "border-white"
                    }`}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex gap-1.5">
                <button
                  onClick={submit}
                  className="flex-1 rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800"
                >
                  Add
                </button>
                <button
                  onClick={reset}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-gray-400">
                Needs a WFS 2.0 endpoint that supports GeoJSON output and allows
                cross-origin requests — this app has no server-side proxy, so a source
                without CORS simply won&apos;t load (it may still open fine in a plain
                browser tab).
              </p>
            </div>
          )}

          {notActive.length > 0 && (
            <ul className="space-y-1">
              {notActive.map((c) => (
                <li key={c.id} className="flex items-center gap-1">
                  <button
                    onClick={() => addLayer(c.id)}
                    className="flex flex-1 items-center rounded-md border border-dashed border-gray-300 bg-white px-2 py-1.5 text-left text-sm text-gray-700 hover:border-emerald-600 hover:text-emerald-800"
                  >
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: c.color }}
                    />
                    + {c.name}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${c.name}"? This forgets the saved URL.`))
                        removeCustomOverlayDef(c.id);
                    }}
                    className="px-1 text-gray-400 hover:text-red-600"
                    aria-label={`Delete ${c.name}`}
                    title="Delete this source"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
