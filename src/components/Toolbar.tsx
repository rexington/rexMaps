"use client";

import { formatDistance, pathLength } from "@/lib/geo";
import { draftCursorPath } from "@/lib/layers/objectLayers";
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
];

export default function Toolbar() {
  const tool = useMapStore((s) => s.tool);
  const setTool = useMapStore((s) => s.setTool);
  return (
    <div className="absolute left-1/2 top-2 flex -translate-x-1/2 overflow-hidden rounded-lg bg-white/95 shadow">
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

/** Floating hint + snap toggle + running distance while drawing. */
export function DrawHint() {
  const tool = useMapStore((s) => s.tool);
  const draft = useMapStore((s) => s.draft);
  const snapEnabled = useMapStore((s) => s.snapEnabled);
  const toggleSnap = useMapStore((s) => s.toggleSnap);
  const draftUndo = useMapStore((s) => s.draftUndo);
  if (tool === "select") return null;

  let text: string;
  if (tool === "marker") {
    text = "Click the map to place markers · Esc to finish";
  } else {
    // Committed legs + the cursor segment (routed preview when available).
    const committed = draft ? legsToCoords(draft.legs) : [];
    const cursorPath = draft ? (draftCursorPath(draft) ?? []) : [];
    const total = pathLength(committed) + pathLength(cursorPath);
    const dist = total > 0 ? ` · ${formatDistance(total)}` : "";
    text = `Click to add points · Enter/double-click finishes · Backspace undoes · Esc cancels${dist}`;
  }
  return (
    <div className="absolute left-1/2 top-14 flex -translate-x-1/2 items-center gap-2 rounded-full bg-gray-900/80 px-4 py-1.5 text-xs text-white shadow">
      <span>{text}</span>
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
