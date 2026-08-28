"use client";

import {
  Map as MaplibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { bounds } from "@/lib/geo";
import { buildStyle } from "@/lib/layers/compositor";
import { OBJECTS_SOURCE } from "@/lib/layers/objectLayers";
import { registerSentinelProtocol } from "@/lib/layers/sentinel";
import { registerSlopeProtocol } from "@/lib/layers/slope";
import { mapRef } from "@/lib/mapRef";
import { ensureMarkerIcons } from "@/lib/markerIcons";
import { objectsToFeatureCollection } from "@/lib/objects";
import type { SavedMapData } from "@/lib/savedMaps";
import ProfilePanel from "./ProfilePanel";

// Pixel padding around a click so thin lines are easier to hit than their
// exact rendered width — same value MapView uses.
const HIT_PAD = 4;

/** Topmost drawn object at a screen point (markers beat lines beat
 * polygons) — same priority MapView's own hit test uses, so a marker
 * sitting on a line still wins here. There are no drag handles to filter
 * out in this view (selection never renders them — see below), unlike
 * MapView's version of this function. */
function hitTest(map: MaplibreMap, point: MapMouseEvent["point"]): string | null {
  const rank = { marker: 0, line: 1, polygon: 2 } as Record<string, number>;
  const hits = map
    .queryRenderedFeatures([
      [point.x - HIT_PAD, point.y - HIT_PAD],
      [point.x + HIT_PAD, point.y + HIT_PAD],
    ])
    .filter((f) => f.source === OBJECTS_SOURCE)
    .sort((a, b) => (rank[a.properties?.kind] ?? 9) - (rank[b.properties?.kind] ?? 9));
  return (hits[0]?.properties?.id as string | undefined) ?? null;
}

// Same one-time setup as MapView — Turbopack breaks maplibre's own worker
// bootstrapping, and slope/sentinel tiles need their custom protocols
// registered before any style referencing them is applied.
setWorkerUrl("/maplibre-gl-worker.mjs");
registerSlopeProtocol();
registerSentinelProtocol();

/**
 * Read-only viewer for a publicly-shared map (`/m/[id]`) — deliberately a
 * separate, much smaller component from MapView rather than a "read-only
 * mode" bolted onto it: no editing/session state, no store subscription, no
 * fetches beyond the one public endpoint. Reuses the same compositor +
 * object-rendering pipeline everything else does (see AGENTS.md) so a
 * shared map looks exactly like the original.
 */
export default function PublicMapView({ id }: { id: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "not-found" | "ready">("loading");
  const [title, setTitle] = useState("");
  const [data, setData] = useState<SavedMapData | null>(null);
  // Which line's elevation profile is showing, if any — local to this
  // component, not the editing store (this view has no store at all). Not
  // fed back into the objects source's "selected" property: that would
  // also render drag handles (see objectLayers.ts), which would be a false
  // edit affordance in a read-only view.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public-maps/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ title: string; data: SavedMapData }>;
      })
      .then((body) => {
        if (cancelled) return;
        setTitle(body.title);
        setData(body.data);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("not-found");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!data || !containerRef.current) return;
    const objectsFC = objectsToFeatureCollection(data.objects, null);
    const map = new MaplibreMap({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: [data.viewport.lng, data.viewport.lat],
      zoom: data.viewport.zoom,
      attributionControl: { compact: true },
      interactive: true,
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
    mapRef.current = map;
    // Debug/console access (harmless in prod; used by headless verification,
    // same as MapView's identical hook).
    (window as unknown as { __rexmap?: MaplibreMap }).__rexmap = map;

    map.on("click", (e) => {
      const hitId = hitTest(map, e.point);
      const hit = hitId ? data.objects.find((o) => o.id === hitId) : undefined;
      setSelectedId(hit?.kind === "line" ? hit.id : null);
    });
    map.on("mousemove", (e) => {
      map.getCanvas().style.cursor = hitTest(map, e.point) ? "pointer" : "";
    });

    let cancelled = false;
    buildStyle(data.stack, objectsFC).then((style) => {
      if (cancelled) return;
      map.setStyle(style);
      ensureMarkerIcons(map, data.objects);
      const box = bounds(data.objects.flatMap((o) => o.coords));
      if (box) {
        map.fitBounds(
          [
            [box[0], box[1]],
            [box[2], box[3]],
          ],
          { padding: 48, duration: 0, maxZoom: 16 },
        );
      }
    });

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
      setSelectedId(null);
    };
  }, [data]);

  if (status === "not-found") {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 bg-gray-100 px-4 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Map not found</h1>
        <p className="max-w-sm text-sm text-gray-500">
          This link doesn&apos;t point to a public map — it may have been made private or
          deleted.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full">
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-100 text-gray-500">
          Loading map…
        </div>
      )}
      {status === "ready" && (
        <div className="absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-gray-900 shadow">
          {title}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
      <ProfilePanel
        obj={data?.objects.find((o) => o.id === selectedId)}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
