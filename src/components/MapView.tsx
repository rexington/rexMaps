"use client";

import {
  GeolocateControl,
  Map as MaplibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { elevationAt } from "@/lib/elevation";
import { metersToFeet, type LngLat } from "@/lib/geo";
import { buildStyle } from "@/lib/layers/compositor";
import { loadOverlayInto, type CustomOverlayDef } from "@/lib/layers/customOverlay";
import type { ActiveLayer } from "@/lib/layers/types";
import {
  DRAFT_SOURCE,
  EMPTY_FC,
  OBJECTS_SOURCE,
  draftFeatureCollection,
} from "@/lib/layers/objectLayers";
import { mapRef } from "@/lib/mapRef";
import { ensureMarkerIcons } from "@/lib/markerIcons";
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
import SearchBox from "./SearchBox";
import Toolbar, { DrawHint } from "./Toolbar";
import { registerSentinelProtocol } from "@/lib/layers/sentinel";
import { registerSlopeProtocol } from "@/lib/layers/slope";

// Self-hosted worker (copied to public/ on postinstall) — Turbopack breaks
// maplibre's own worker URL, which silently disables all vector tile loading.
setWorkerUrl("/maplibre-gl-worker.mjs");
// slope://terrarium/{z}/{x}/{y} tiles, computed client-side from the DEM.
registerSlopeProtocol();
// sentinel://tile/{z}/{x}/{y} — rewrites TILEMATRIX for the CDSE WMTS grid.
registerSentinelProtocol();

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

// Pixel padding around click/hover points so thin lines are easier to grab
// than their exact rendered width.
const HIT_PAD = 4;
function hitBox(point: MapMouseEvent["point"]): [[number, number], [number, number]] {
  return [
    [point.x - HIT_PAD, point.y - HIT_PAD],
    [point.x + HIT_PAD, point.y + HIT_PAD],
  ];
}

/** Topmost drawn object at a screen point (markers beat lines beat polygons). */
function hitTest(map: MaplibreMap, point: MapMouseEvent["point"]): string | null {
  const rank = { marker: 0, line: 1, polygon: 2 } as Record<string, number>;
  const hits = map
    .queryRenderedFeatures(hitBox(point))
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

const isCustomOverlaySource = (source: unknown) =>
  typeof source === "string" && source.startsWith("custom-overlay:");

/** A custom-overlay feature (any layer) at a screen point, if any. */
function customOverlayFeatureAt(map: MaplibreMap, point: MapMouseEvent["point"]) {
  return map
    .queryRenderedFeatures(hitBox(point))
    .find((f) => isCustomOverlaySource(f.source));
}

/** Builds popup content from raw feature properties via textContent only —
 * this data comes from a user-supplied third-party URL, so it must never be
 * parsed as HTML (see showCustomOverlayPopup). */
function buildPopupContent(props: Record<string, unknown>): HTMLElement {
  const container = document.createElement("div");
  container.style.fontSize = "12px";
  container.style.maxHeight = "200px";
  container.style.overflowY = "auto";
  const entries = Object.entries(props).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) {
    container.textContent = "No attributes";
    container.style.color = "#6b7280";
    return container;
  }
  const table = document.createElement("table");
  table.style.borderCollapse = "collapse";
  for (const [k, v] of entries) {
    const row = table.insertRow();
    const keyCell = row.insertCell();
    keyCell.textContent = k;
    keyCell.style.paddingRight = "8px";
    keyCell.style.color = "#6b7280";
    keyCell.style.verticalAlign = "top";
    const valCell = row.insertCell();
    valCell.textContent = String(v);
  }
  container.appendChild(table);
  return container;
}

function showCustomOverlayPopup(map: MaplibreMap, e: MapMouseEvent) {
  const hit = customOverlayFeatureAt(map, e.point);
  if (!hit) return;
  new Popup({ closeButton: true, maxWidth: "260px" })
    .setLngLat(e.lngLat)
    .setDOMContent(buildPopupContent(hit.properties ?? {}))
    .addTo(map);
}

/** Active custom-overlay defs currently visible in the stack. */
function activeCustomOverlays(
  stack: ActiveLayer[],
  customOverlays: CustomOverlayDef[],
): CustomOverlayDef[] {
  const out: CustomOverlayDef[] = [];
  for (const l of stack) {
    if (!l.visible) continue;
    const def = customOverlays.find((c) => c.id === l.defId);
    if (def) out.push(def);
  }
  return out;
}

function currentBbox(map: MaplibreMap): [number, number, number, number] {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/** Refetches every active custom overlay for the current viewport. Called
 * right after a style rebuild (so freshly-added empty sources get populated)
 * and, debounced, whenever the viewport changes (see CustomOverlayData). */
function refreshCustomOverlays(
  map: MaplibreMap,
  active: CustomOverlayDef[],
  signal: AbortSignal | undefined,
  setStatus: (id: string, status: { loading: boolean; error: string | null }) => void,
) {
  if (active.length === 0) return;
  const bbox = currentBbox(map);
  for (const def of active) {
    loadOverlayInto(map, def, bbox, signal, setStatus);
  }
}

/** Live-refetches active custom overlays as the user pans/zooms. Rendered
 * unconditionally from MapView's JSX (not inside a collapsible panel) — a
 * layer's data source has to keep updating even while LayerPanel is closed,
 * which it defaults to since the mobile layout pass. */
function CustomOverlayData() {
  const stack = useMapStore((s) => s.stack);
  const customOverlays = useMapStore((s) => s.customOverlays);
  const viewport = useMapStore((s) => s.viewport);
  const setStatus = useMapStore((s) => s.setCustomOverlayStatus);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const active = activeCustomOverlays(stack, customOverlays);
    if (active.length === 0) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      refreshCustomOverlays(map, active, controller.signal, setStatus);
    }, 400);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [stack, customOverlays, viewport, setStatus]);

  return null;
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const buildSeq = useRef(0);
  const [elevationM, setElevationM] = useState<number | null>(null);
  const stack = useMapStore((s) => s.stack);
  const sentinel = useMapStore((s) => s.sentinel);
  const customOverlays = useMapStore((s) => s.customOverlays);
  // "Possible routes" hint: only while actually drawing a snapped line.
  const trailOverlay = useMapStore((s) => s.tool === "line" && s.snapEnabled);

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
            // Drawn objects win the hit-test over custom-overlay features.
            const objId = hitTest(map, e.point);
            s.setSelected(objId);
            if (!objId) showCustomOverlayPopup(map, e);
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
          : hitTest(map, e.point) || customOverlayFeatureAt(map, e.point)
            ? "pointer"
            : "";
      }
    });

    // DEM elevation readout at the cursor. Trailing-throttled: tile-cache
    // hits resolve fast but are still async, and mousemove can fire well
    // over 60/sec — only the latest pending point survives each tick.
    const ELEVATION_THROTTLE_MS = 120;
    let elevationTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingElevationPt: LngLat | null = null;
    map.on("mousemove", (e) => {
      pendingElevationPt = lngLat(e);
      if (elevationTimer) return;
      elevationTimer = setTimeout(() => {
        elevationTimer = null;
        const pt = pendingElevationPt;
        if (pt) elevationAt(pt).then((m) => setElevationM(m));
      }, ELEVATION_THROTTLE_MS);
    });
    map.on("mouseout", () => setElevationM(null));

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
        if (s.objects !== prev.objects) ensureMarkerIcons(map, s.objects);
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
    // Icons for whatever markers were already loaded from persisted state —
    // the subscribe fast-path above only fires on later *changes*.
    ensureMarkerIcons(map, useMapStore.getState().objects);
    // Debug/console access (harmless in prod; used by headless verification).
    (window as unknown as { __rexmap?: MaplibreMap }).__rexmap = map;
    (window as unknown as { __rexstore?: typeof useMapStore }).__rexstore =
      useMapStore;
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
      if (elevationTimer) clearTimeout(elevationTimer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Rebuild style whenever the layer stack, Sentinel options (which change
  // that layer's tile URLs), or the trail-overlay condition changes; embeds
  // current object data.
  useEffect(() => {
    const seq = ++buildSeq.current;
    let cancelled = false;
    buildStyle(stack, currentObjectsFC(), currentDraftFC(), {
      trailOverlay,
      customOverlays,
    }).then((style) => {
      if (cancelled || seq !== buildSeq.current) return;
      const map = mapRef.current;
      if (!map) return;
      map.setStyle(style, { diff: true });
      // Defensive: re-ensure marker images in case setStyle reset them.
      ensureMarkerIcons(map, useMapStore.getState().objects);
      // Custom-overlay sources are always seeded empty by the compositor —
      // populate them now that they actually exist in the applied style.
      refreshCustomOverlays(
        map,
        activeCustomOverlays(stack, customOverlays),
        undefined,
        useMapStore.getState().setCustomOverlayStatus,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [stack, sentinel, trailOverlay, customOverlays]);

  return (
    <div className="relative h-dvh w-full">
      {/* Explicit h/w: maplibre's stylesheet forces position:relative on this
          div, so absolute-positioning classes can't size it. */}
      <div ref={containerRef} className="h-full w-full" />
      {/* Mobile: vertical stack on the right, clear of the top corner
          dropdowns. sm: and up: horizontal, top-center (original layout). */}
      <div className="absolute right-2 top-20 z-10 flex flex-col items-end gap-2 sm:left-1/2 sm:right-auto sm:top-2 sm:flex-row sm:items-start sm:-translate-x-1/2">
        <Toolbar />
        <SearchBox />
      </div>
      <DrawHint />
      <ObjectsPanel />
      <LayerPanel />
      <ProfilePanel />
      <CustomOverlayData />
      {elevationM !== null && (
        <div className="absolute bottom-8 left-2 z-10 rounded-md bg-white/95 px-2 py-1 text-xs tabular-nums text-gray-700 shadow">
          {metersToFeet(elevationM).toLocaleString()} ft
        </div>
      )}
    </div>
  );
}
