"use client";

import {
  GeolocateControl,
  Map as MaplibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { LngLat } from "@/lib/geo";
import { buildStyle } from "@/lib/layers/compositor";
import {
  DRAFT_SOURCE,
  EMPTY_FC,
  OBJECTS_SOURCE,
  draftFeatureCollection,
} from "@/lib/layers/objectLayers";
import { mapRef } from "@/lib/mapRef";
import { objectsToFeatureCollection } from "@/lib/objects";
import {
  appendDraftPoint,
  moveObjectVertex,
  refitObjectVertex,
  scheduleDraftPreview,
  useMapStore,
} from "@/store/mapStore";
import LayerPanel from "./LayerPanel";
import ObjectsPanel from "./ObjectsPanel";
import ProfilePanel from "./ProfilePanel";
import Toolbar, { DrawHint } from "./Toolbar";

// Self-hosted worker (copied to public/ on postinstall) — Turbopack breaks
// maplibre's own worker URL, which silently disables all vector tile loading.
setWorkerUrl("/maplibre-gl-worker.mjs");

function currentObjectsFC() {
  const s = useMapStore.getState();
  return objectsToFeatureCollection(s.objects, s.selectedId);
}

function currentDraftFC() {
  const s = useMapStore.getState();
  if (!s.draft || (s.tool !== "line" && s.tool !== "polygon")) return EMPTY_FC;
  return draftFeatureCollection(s.tool, s.draft);
}

function setSourceData(map: MaplibreMap, id: string, data: ReturnType<typeof currentObjectsFC>) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  src?.setData(data);
}

/** Topmost drawn object at a screen point (markers beat lines beat polygons). */
function hitTest(map: MaplibreMap, point: MapMouseEvent["point"]): string | null {
  const rank = { marker: 0, line: 1, polygon: 2 } as Record<string, number>;
  const hits = map
    .queryRenderedFeatures(point)
    .filter((f) => f.source === OBJECTS_SOURCE && !f.properties?.handle)
    .sort((a, b) => (rank[a.properties?.kind] ?? 9) - (rank[b.properties?.kind] ?? 9));
  return (hits[0]?.properties?.id as string | undefined) ?? null;
}

/** Drag handle (selected object's vertex) at a screen point, if any. */
function handleAt(
  map: MaplibreMap,
  point: MapMouseEvent["point"],
): { id: string; idx: number } | null {
  const hit = map
    .queryRenderedFeatures(point)
    .find((f) => f.source === OBJECTS_SOURCE && f.properties?.handle);
  if (!hit) return null;
  return { id: hit.properties!.id as string, idx: hit.properties!.idx as number };
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const buildSeq = useRef(0);
  const stack = useMapStore((s) => s.stack);

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const { viewport } = useMapStore.getState();
    const map = new MaplibreMap({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: [viewport.lng, viewport.lat],
      zoom: viewport.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "bottom-right",
    );
    map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");

    map.on("moveend", () => {
      const c = map.getCenter();
      useMapStore.getState().setViewport({
        lng: +c.lng.toFixed(5),
        lat: +c.lat.toFixed(5),
        zoom: +map.getZoom().toFixed(2),
      });
    });

    // --- Drawing interactions (read state via getState to avoid stale closures)
    const lngLat = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];
    let justDragged = false;

    map.on("click", (e) => {
      const s = useMapStore.getState();
      switch (s.tool) {
        case "marker":
          s.addMarker(lngLat(e));
          break;
        case "line":
        case "polygon":
          appendDraftPoint(lngLat(e));
          break;
        case "select":
          // Ignore the click that ends a vertex drag; keep selection when
          // clicking a drag handle.
          if (justDragged) {
            justDragged = false;
          } else if (!handleAt(map, e.point)) {
            s.setSelected(hitTest(map, e.point));
          }
          break;
      }
    });

    // Vertex drag editing: grab a handle, adjacent legs go straight while
    // dragging, snapped legs re-route on release.
    map.on("mousedown", (e) => {
      const s = useMapStore.getState();
      if (s.tool !== "select" || !s.selectedId) return;
      const handle = handleAt(map, e.point);
      if (!handle) return;
      e.preventDefault(); // suppress map drag-pan
      map.getCanvas().style.cursor = "grabbing";
      const onMove = (ev: MapMouseEvent) =>
        moveObjectVertex(handle.id, handle.idx, lngLat(ev));
      const onUp = () => {
        map.off("mousemove", onMove);
        map.getCanvas().style.cursor = "";
        justDragged = true;
        refitObjectVertex(handle.id, handle.idx);
      };
      map.on("mousemove", onMove);
      map.once("mouseup", onUp);
    });

    map.on("dblclick", (e) => {
      const s = useMapStore.getState();
      if (s.tool === "line" || s.tool === "polygon") {
        e.preventDefault();
        s.draftFinish();
      }
    });

    map.on("mousemove", (e) => {
      const s = useMapStore.getState();
      if (s.draft) {
        s.draftCursor(lngLat(e));
        scheduleDraftPreview();
      } else if (s.tool === "select") {
        map.getCanvas().style.cursor = handleAt(map, e.point)
          ? "grab"
          : hitTest(map, e.point)
            ? "pointer"
            : "";
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const s = useMapStore.getState();
      if (e.key === "Enter" && s.draft) {
        s.draftFinish();
      } else if (e.key === "Escape") {
        if (s.draft) s.draftCancel();
        else if (s.tool !== "select") s.setTool("select");
        else s.setSelected(null);
      } else if (
        (e.key === "Delete" ||
          e.key === "Backspace" ||
          (e.key === "z" && (e.metaKey || e.ctrlKey))) &&
        s.draft
      ) {
        e.preventDefault();
        s.draftUndo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selectedId) {
        s.removeObject(s.selectedId);
      } else if (e.key === "s" && s.tool === "line") {
        s.toggleSnap();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // --- Fast-path store subscription: data + interaction state (no re-render)
    const unsubscribe = useMapStore.subscribe((s, prev) => {
      if (s.objects !== prev.objects || s.selectedId !== prev.selectedId) {
        setSourceData(map, OBJECTS_SOURCE, currentObjectsFC());
      }
      if (s.draft !== prev.draft || s.tool !== prev.tool) {
        setSourceData(map, DRAFT_SOURCE, currentDraftFC());
      }
      if (s.tool !== prev.tool) {
        map.getCanvas().style.cursor = s.tool === "select" ? "" : "crosshair";
        if (s.tool === "select") map.doubleClickZoom.enable();
        else map.doubleClickZoom.disable();
      }
    });

    mapRef.current = map;
    // Debug/console access (harmless in prod; used by headless verification).
    (window as unknown as { __rexmap?: MaplibreMap }).__rexmap = map;
    (window as unknown as { __rexstore?: typeof useMapStore }).__rexstore =
      useMapStore;
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Rebuild style whenever the layer stack changes (embeds current object data).
  useEffect(() => {
    const seq = ++buildSeq.current;
    let cancelled = false;
    buildStyle(stack, currentObjectsFC(), currentDraftFC()).then((style) => {
      if (cancelled || seq !== buildSeq.current) return;
      mapRef.current?.setStyle(style, { diff: true });
    });
    return () => {
      cancelled = true;
    };
  }, [stack]);

  return (
    <div className="relative h-dvh w-full">
      {/* Explicit h/w: maplibre's stylesheet forces position:relative on this
          div, so absolute-positioning classes can't size it. */}
      <div ref={containerRef} className="h-full w-full" />
      <Toolbar />
      <DrawHint />
      <ObjectsPanel />
      <LayerPanel />
      <ProfilePanel />
    </div>
  );
}
