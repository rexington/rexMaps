"use client";

import { Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { elevationProfile, type ElevationProfile } from "@/lib/elevation";
import { formatDistance } from "@/lib/geo";
import { mapRef } from "@/lib/mapRef";
import { useMapStore } from "@/store/mapStore";

const W = 520;
const H = 110;
const PAD = { l: 44, r: 10, t: 8, b: 18 };
const ft = (m: number) => Math.round(m * 3.28084);

function useHoverMarker() {
  const markerRef = useRef<Marker | null>(null);
  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    [],
  );
  return {
    show(pt: [number, number]) {
      if (!mapRef.current) return;
      if (!markerRef.current) {
        const el = document.createElement("div");
        el.className =
          "h-3 w-3 rounded-full border-2 border-white bg-gray-900 shadow";
        markerRef.current = new Marker({ element: el });
        markerRef.current.setLngLat(pt).addTo(mapRef.current);
      } else {
        markerRef.current.setLngLat(pt);
      }
    },
    hide() {
      markerRef.current?.remove();
      markerRef.current = null;
    },
  };
}

interface ProfileResult {
  forCoords: unknown;
  profile: ElevationProfile | null;
}

export default function ProfilePanel() {
  const obj = useMapStore((s) => s.objects.find((o) => o.id === s.selectedId));
  const setSelected = useMapStore((s) => s.setSelected);
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const marker = useHoverMarker();

  const isLine = obj?.kind === "line";
  const coords = isLine && obj.coords.length >= 2 ? obj.coords : null;

  useEffect(() => {
    marker.hide();
    if (!coords) return;
    let cancelled = false;
    elevationProfile(coords).then((p) => {
      if (!cancelled) setResult({ forCoords: coords, profile: p });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marker is a stable helper
  }, [coords]);

  if (!isLine || !obj || !coords) return null;

  // Loading/error are derived: `result` only counts for the coords it was
  // computed from (edits and selection changes restart the fetch).
  const loaded = result?.forCoords === coords;
  const profile = loaded ? result.profile : null;
  const state: "loading" | "error" | "ready" = !loaded
    ? "loading"
    : profile
      ? "ready"
      : "error";
  const hover =
    hoverIdx !== null && profile && hoverIdx < profile.points.length
      ? hoverIdx
      : null;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  let path = "";
  let area = "";
  if (profile) {
    const span = Math.max(1, profile.maxEle - profile.minEle);
    const pts = profile.points.map((p) => [
      PAD.l + (p.dist / profile.totalDist) * innerW,
      PAD.t + (1 - (p.ele - profile.minEle) / span) * innerH,
    ]);
    path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    area = `${path}L${PAD.l + innerW},${PAD.t + innerH}L${PAD.l},${PAD.t + innerH}Z`;
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!profile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const dist = ((x - PAD.l) / innerW) * profile.totalDist;
    let best = 0;
    for (let i = 1; i < profile.points.length; i++) {
      if (
        Math.abs(profile.points[i].dist - dist) <
        Math.abs(profile.points[best].dist - dist)
      )
        best = i;
    }
    setHoverIdx(best);
    marker.show(profile.points[best].pt);
  }

  const hoverPt = hover !== null && profile ? profile.points[hover] : null;
  const span = profile ? Math.max(1, profile.maxEle - profile.minEle) : 1;

  return (
    <div className="absolute bottom-8 left-1/2 w-[540px] max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-lg bg-white/95 p-2 shadow-lg backdrop-blur">
      <div className="flex items-baseline gap-3 px-1 pb-1">
        <span className="truncate text-sm font-medium text-gray-900">{obj.title}</span>
        <span className="text-xs text-gray-600">
          {formatDistance(profile?.totalDist ?? 0)}
          {profile && (
            <>
              {" · "}
              <span className="text-emerald-700">+{ft(profile.gainM).toLocaleString()} ft</span>
              {" / "}
              <span className="text-red-700">−{ft(profile.lossM).toLocaleString()} ft</span>
            </>
          )}
        </span>
        {hoverPt && (
          <span className="text-xs tabular-nums text-gray-500">
            {formatDistance(hoverPt.dist)} · {ft(hoverPt.ele).toLocaleString()} ft
          </span>
        )}
        <button
          onClick={() => setSelected(null)}
          className="ml-auto px-1 text-gray-400 hover:text-gray-700"
          aria-label="Close profile"
        >
          ✕
        </button>
      </div>
      {state === "loading" && (
        <div className="flex h-[110px] items-center justify-center text-sm text-gray-400">
          Loading elevation…
        </div>
      )}
      {state === "error" && (
        <div className="flex h-[110px] items-center justify-center text-sm text-gray-400">
          Elevation unavailable for this line.
        </div>
      )}
      {profile && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          onMouseMove={onMove}
          onMouseLeave={() => {
            setHoverIdx(null);
            marker.hide();
          }}
        >
          <text x={PAD.l - 6} y={PAD.t + 8} textAnchor="end" className="fill-gray-400 text-[10px]">
            {ft(profile.maxEle).toLocaleString()}
          </text>
          <text
            x={PAD.l - 6}
            y={PAD.t + innerH}
            textAnchor="end"
            className="fill-gray-400 text-[10px]"
          >
            {ft(profile.minEle).toLocaleString()}
          </text>
          <text
            x={PAD.l + innerW}
            y={H - 4}
            textAnchor="end"
            className="fill-gray-400 text-[10px]"
          >
            {formatDistance(profile.totalDist)}
          </text>
          <path d={area} fill="#059669" opacity={0.15} />
          <path d={path} fill="none" stroke="#047857" strokeWidth={1.5} />
          {hoverPt && (
            <>
              <line
                x1={PAD.l + (hoverPt.dist / profile.totalDist) * innerW}
                x2={PAD.l + (hoverPt.dist / profile.totalDist) * innerW}
                y1={PAD.t}
                y2={PAD.t + innerH}
                stroke="#6b7280"
                strokeDasharray="3 2"
              />
              <circle
                cx={PAD.l + (hoverPt.dist / profile.totalDist) * innerW}
                cy={PAD.t + (1 - (hoverPt.ele - profile.minEle) / span) * innerH}
                r={3.5}
                fill="#111827"
                stroke="#fff"
                strokeWidth={1.5}
              />
            </>
          )}
        </svg>
      )}
    </div>
  );
}
