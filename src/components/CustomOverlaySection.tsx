"use client";

import { useState } from "react";
import { OBJECT_COLORS } from "@/lib/objects";
import { parseCustomOverlayInput } from "@/lib/customOverlaysApi";
import { addCustomOverlay, removeCustomOverlayDef, useMapStore } from "@/store/mapStore";

export default function CustomOverlaySection() {
  const [open, setOpen] = useState(false);
  const [forming, setForming] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [typeName, setTypeName] = useState("");
  const [labelField, setLabelField] = useState("");
  const [propertyNames, setPropertyNames] = useState("");
  const [color, setColor] = useState<string>(OBJECT_COLORS[4]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stack = useMapStore((s) => s.stack);
  const customOverlays = useMapStore((s) => s.customOverlays);
  const customOverlaysLoaded = useMapStore((s) => s.customOverlaysLoaded);
  const { addLayer } = useMapStore();

  const notActive = customOverlays.filter((c) => !stack.some((l) => l.defId === c.id));

  function reset() {
    setName("");
    setUrl("");
    setTypeName("");
    setLabelField("");
    setPropertyNames("");
    setFormError(null);
    setForming(false);
  }

  async function submit() {
    const input = parseCustomOverlayInput({
      name,
      url,
      typeName,
      color,
      labelField: labelField.trim() || undefined,
      propertyNames: propertyNames.trim() || undefined,
    });
    if (!input) {
      setFormError(
        !name.trim() || !url.trim() || !typeName.trim()
          ? "Name, URL, and type name are all required."
          : "That doesn't look like a valid https:// URL.",
      );
      return;
    }
    setSubmitting(true);
    try {
      await addCustomOverlay(input);
      reset();
    } catch (err) {
      console.warn("failed to add custom overlay", err);
      setFormError("Couldn't save that overlay — try again.");
    } finally {
      setSubmitting(false);
    }
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
              <input
                value={propertyNames}
                onChange={(e) => setPropertyNames(e.target.value)}
                placeholder="Fields to load (optional, comma-separated — blank = all)"
                className={input}
                aria-label="Fields to load"
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
                  disabled={submitting}
                  className="flex-1 rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {submitting ? "Adding…" : "Add"}
                </button>
                <button
                  onClick={reset}
                  disabled={submitting}
                  className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-gray-400">
                Needs a WFS 2.0 endpoint that supports GeoJSON output and allows
                cross-origin requests — this app has no server-side proxy, so a source
                without CORS simply won&apos;t load (it may still open fine in a plain
                browser tab). Fields to load restricts the server response to just
                those attributes (your label field always rides along even if you
                leave it out of the list). Nothing here can be edited later — delete
                and re-add to change any of it.
              </p>
            </div>
          )}

          {!customOverlaysLoaded && (
            <p className="px-1 text-xs text-gray-400">Loading…</p>
          )}

          {customOverlaysLoaded && notActive.length > 0 && (
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
                        removeCustomOverlayDef(c.id).catch((err) => {
                          console.warn("failed to delete custom overlay", err);
                          alert("Couldn't delete that overlay — try again.");
                        });
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
