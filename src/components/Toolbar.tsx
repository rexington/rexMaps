"use client";

import { useState } from "react";
import { formatDistance, parseLatLng, pathLength } from "@/lib/geo";
import { draftCursorPath } from "@/lib/layers/objectLayers";
import { mapRef } from "@/lib/mapRef";
import { legsToCoords } from "@/lib/objects";
import { useMapStore, type Tool } from "@/store/mapStore";

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode; key: string }[] = [
  {
    tool: "select",
    label: "Select (Esc)",
    key: "select",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M6 3l12 8.5-5.2 1 3 5.8-2.6 1.3-3-5.9-4.2 3.3z" />
      </svg>
    ),
  },
  {
    tool: "marker",
    label: "Add marker",
    key: "marker",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
      </svg>
    ),
  },
  {
    tool: "line",
    label: "Draw line",
    key: "line",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 20 L10 8 L15 13 L20 4" />
        <circle cx="4" cy="20" r="1.8" fill="currentColor" />
        <circle cx="20" cy="4" r="1.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    tool: "polygon",
    label: "Draw polygon",
    key: "polygon",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3 L21 10 L17 20 L7 20 L3 10 Z" />
      </svg>
    ),
  },
  {
    tool: "query",
    label: "Query features (what's here?)",
    key: "query",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 L21 21" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Toolbar() {
  const tool = useMapStore((s) => s.tool);
  const setTool = useMapStore((s) => s.setTool);
  // Positioned by MapView's container (shared with SearchBox): a vertical
  // stack on the right on mobile, horizontal top-center from sm: up.
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-white/95 shadow sm:flex-row">
      {TOOLS.map(({ tool: t, label, icon, key }) => (
        <button
          key={key}
          onClick={() => setTool(t)}
          title={label}
          aria-label={label}
          aria-pressed={tool === t}
          className={`px-3 py-2 ${
            tool === t
              ? "bg-emerald-700 text-white"
              : "text-gray-700 hover:bg-gray-100"
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/** Inline "lat, lng" entry for placing a marker without clicking the map —
 * useful for a point you know the coordinates of but can't necessarily see
 * on screen yet, so it also flies the camera there. */
function AddMarkerByCoords() {
  const addMarker = useMapStore((s) => s.addMarker);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function submit() {
    const pt = parseLatLng(value);
    if (!pt) {
      setError(true);
      return;
    }
    addMarker(pt);
    const map = mapRef.current;
    if (map) map.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 13) });
    setValue("");
    setError(false);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-1"
    >
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(false);
        }}
        placeholder="or lat, lng"
        className={`w-24 rounded-full bg-white/10 px-2 py-0.5 text-white placeholder:text-gray-400 outline-none ${
          error ? "ring-1 ring-red-400" : ""
        }`}
        aria-label="Marker coordinates (lat, lng)"
      />
      <button
        type="submit"
        className="rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-500"
      >
        + Add
      </button>
    </form>
  );
}

/** Floating hint + snap toggle + running distance while drawing. */
export function DrawHint() {
  const tool = useMapStore((s) => s.tool);
  const draft = useMapStore((s) => s.draft);
  const snapEnabled = useMapStore((s) => s.snapEnabled);
  const toggleSnap = useMapStore((s) => s.toggleSnap);
  const draftUndo = useMapStore((s) => s.draftUndo);
  const draftFinish = useMapStore((s) => s.draftFinish);
  const splitting = useMapStore((s) => s.splitting);
  const setSplitting = useMapStore((s) => s.setSplitting);
  if (tool === "select" && !splitting) return null;

  if (splitting) {
    return (
      <div className="absolute bottom-6 left-2 right-16 z-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl bg-gray-900/90 px-3 py-2 text-xs text-white shadow sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-14 sm:w-auto sm:max-w-none sm:-translate-x-1/2 sm:flex-nowrap sm:rounded-full sm:bg-gray-900/80 sm:px-4 sm:py-1.5">
        <span>Click a vertex on the line to split it there · Esc cancels</span>
        <button
          onClick={() => setSplitting(false)}
          className="rounded-full bg-gray-600 px-2 py-0.5 font-medium text-gray-100 hover:bg-gray-500"
        >
          Cancel
        </button>
      </div>
    );
  }

  let text: string;
  if (tool === "marker") {
    text = "Click the map to place markers · Esc to finish";
  } else if (tool === "query") {
    text = "Click the map to see what OpenStreetMap knows about that spot · Esc to finish";
  } else {
    // Committed legs + the cursor segment (routed preview when available).
    const committed = draft ? legsToCoords(draft.legs) : [];
    const cursorPath = draft ? (draftCursorPath(draft) ?? []) : [];
    const total = pathLength(committed) + pathLength(cursorPath);
    const dist = total > 0 ? ` · ${formatDistance(total)}` : "";
    // Enter/double-click still work (desktop shortcuts); the ✓ Finish chip
    // below is the primary, tap-friendly way to complete on mobile.
    text = `Click to add points · Backspace undoes · Esc cancels${dist}`;
  }
  const minPoints = tool === "polygon" ? 3 : 2;
  return (
    <div className="absolute bottom-6 left-2 right-16 z-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl bg-gray-900/90 px-3 py-2 text-xs text-white shadow sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-14 sm:w-auto sm:max-w-none sm:-translate-x-1/2 sm:flex-nowrap sm:rounded-full sm:bg-gray-900/80 sm:px-4 sm:py-1.5">
      <span>{text}</span>
      {tool === "marker" && <AddMarkerByCoords />}
      {draft && draft.waypoints.length >= minPoints && (
        <button
          onClick={draftFinish}
          className="rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-500"
          title="Finish (Enter)"
        >
          ✓ Finish
        </button>
      )}
      {draft && draft.waypoints.length > 0 && (
        <button
          onClick={draftUndo}
          className="rounded-full bg-gray-600 px-2 py-0.5 font-medium text-gray-100 hover:bg-gray-500"
          title="Undo last point (Backspace)"
        >
          ↩ Undo
        </button>
      )}
      {tool === "line" && (
        <button
          onClick={toggleSnap}
          className={`rounded-full px-2 py-0.5 font-medium ${
            snapEnabled ? "bg-emerald-500 text-white" : "bg-gray-600 text-gray-200"
          }`}
          title="Toggle snap-to-trail routing (s)"
        >
          Snap: {snapEnabled ? "trails" : "off"}
        </button>
      )}
      {draft && draft.pending > 0 && (
        <span className="animate-pulse text-emerald-300">routing…</span>
      )}
    </div>
  );
}
