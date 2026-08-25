"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { googleApiKey } from "@/lib/layers/google";
import { LAYER_DEFS, layerDef } from "@/lib/layers/registry";
import type { ActiveLayer, LayerDef } from "@/lib/layers/types";
import { useMapStore } from "@/store/mapStore";

function needsMissingGoogleKey(def: LayerDef) {
  return (
    def.kind === "raster" && def.tiles === "google-session" && !googleApiKey()
  );
}

function ActiveRow({ entry }: { entry: ActiveLayer }) {
  const def = layerDef(entry.defId);
  const { setOpacity, toggleVisible, removeLayer } = useMapStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.defId });

  if (!def) return null;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-gray-200 bg-white p-2 ${
        isDragging ? "z-10 shadow-lg" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none px-1 text-gray-400 hover:text-gray-600"
          aria-label={`Reorder ${def.name}`}
          title="Drag to reorder"
        >
          ⠿
        </button>
        <span
          className={`flex-1 truncate text-sm ${
            entry.visible ? "text-gray-900" : "text-gray-400"
          }`}
          title={def.description}
        >
          {def.name}
        </span>
        <button
          onClick={() => toggleVisible(entry.defId)}
          className="px-1 text-gray-500 hover:text-gray-800"
          aria-label={entry.visible ? "Hide layer" : "Show layer"}
          title={entry.visible ? "Hide" : "Show"}
        >
          {entry.visible ? "◉" : "◎"}
        </button>
        <button
          onClick={() => removeLayer(entry.defId)}
          className="px-1 text-gray-400 hover:text-red-600"
          aria-label={`Remove ${def.name}`}
          title="Remove"
        >
          ✕
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-6">
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(entry.opacity * 100)}
          onChange={(e) => setOpacity(entry.defId, Number(e.target.value) / 100)}
          className="h-1 flex-1 accent-emerald-700"
          aria-label={`${def.name} opacity`}
        />
        <span className="w-9 text-right text-xs tabular-nums text-gray-500">
          {Math.round(entry.opacity * 100)}%
        </span>
      </div>
    </li>
  );
}

export default function LayerPanel() {
  const { stack, addLayer, moveLayer } = useMapStore();
  const [open, setOpen] = useState(true);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Display top of stack first; DnD indices are in display order.
  const displayed = [...stack].reverse();
  const toStackIndex = (displayIndex: number) => stack.length - 1 - displayIndex;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = displayed.findIndex((l) => l.defId === active.id);
    const to = displayed.findIndex((l) => l.defId === over.id);
    if (from === -1 || to === -1) return;
    moveLayer(toStackIndex(from), toStackIndex(to));
  }

  const available = LAYER_DEFS.filter(
    (d) => !stack.some((l) => l.defId === d.id),
  );
  const bases = available.filter((d) => d.category === "base");
  const overlays = available.filter((d) => d.category === "overlay");

  return (
    <div className="absolute right-2 top-2 w-72 max-w-[calc(100vw-1rem)] select-none">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mb-1 ml-auto block rounded-md bg-white/95 px-3 py-1.5 text-sm font-medium text-gray-800 shadow"
      >
        {open ? "Layers ▾" : "Layers ▸"}
      </button>
      {open && (
        <div className="max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto rounded-lg bg-gray-50/95 p-2 shadow-lg backdrop-blur">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={displayed.map((l) => l.defId)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1.5">
                {displayed.map((entry) => (
                  <ActiveRow key={entry.defId} entry={entry} />
                ))}
                {displayed.length === 0 && (
                  <li className="p-2 text-center text-sm text-gray-500">
                    No layers — add one below
                  </li>
                )}
              </ul>
            </SortableContext>
          </DndContext>

          {[
            ["Add base layer", bases] as const,
            ["Add overlay", overlays] as const,
          ].map(
            ([label, defs]) =>
              defs.length > 0 && (
                <div key={label}>
                  <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {label}
                  </h3>
                  <ul className="space-y-1">
                    {defs.map((def) => {
                      const noKey = needsMissingGoogleKey(def);
                      return (
                        <li key={def.id}>
                          <button
                            onClick={() => addLayer(def.id)}
                            disabled={noKey}
                            title={
                              noKey
                                ? "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable"
                                : def.description
                            }
                            className="w-full rounded-md border border-dashed border-gray-300 bg-white px-2 py-1.5 text-left text-sm text-gray-700 hover:border-emerald-600 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            + {def.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}
