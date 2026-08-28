"use client";

import { Map as MaplibreMap, NavigationControl, ScaleControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { bounds } from "@/lib/geo";
import { buildStyle } from "@/lib/layers/compositor";
import { registerSentinelProtocol } from "@/lib/layers/sentinel";
import { registerSlopeProtocol } from "@/lib/layers/slope";
import { ensureMarkerIcons } from "@/lib/markerIcons";
import { objectsToFeatureCollection } from "@/lib/objects";
import type { SavedMapData } from "@/lib/savedMaps";

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
    </div>
  );
}
