"use client";

import { useRef, useState } from "react";
import { parseLatLng } from "@/lib/geo";
import { mapRef } from "@/lib/mapRef";

/**
 * Place search via the public Nominatim API. Search runs only on Enter (no
 * autocomplete) to respect Nominatim's 1 req/s etiquette. Also accepts raw
 * "lat, lng" coordinates.
 */

interface Result {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
}

function goTo(r: Result) {
  const map = mapRef.current;
  if (!map) return;
  const bb = r.boundingbox?.map(Number);
  if (bb && bb.length === 4 && bb.every((n) => Number.isFinite(n))) {
    map.fitBounds(
      [
        [bb[2], bb[0]],
        [bb[3], bb[1]],
      ],
      { padding: 60, maxZoom: 15 },
    );
  } else {
    map.flyTo({ center: [Number(r.lon), Number(r.lat)], zoom: 13 });
  }
}

export default function SearchBox() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    setResults(null);
    setError(null);
  }

  async function search() {
    const query = q.trim();
    if (!query) return;

    const coords = parseLatLng(query);
    if (coords) {
      mapRef.current?.flyTo({ center: coords, zoom: 13 });
      setResults(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as Result[];
      setResults(list);
      if (list.length === 1) goTo(list[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          // Focus after the input mounts.
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="rounded-lg bg-white/95 px-3 py-2 text-gray-700 shadow hover:bg-gray-100"
        title="Search places (Nominatim)"
        aria-label="Search places"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 L21 21" />
        </svg>
      </button>
    );
  }

  return (
    <div className="relative w-64">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex items-center overflow-hidden rounded-lg bg-white/95 shadow"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          placeholder="Search place or lat, lng…"
          className="w-full bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          aria-label="Search query"
        />
        {busy && <span className="animate-pulse pr-2 text-xs text-gray-400">…</span>}
        <button
          type="button"
          onClick={close}
          className="px-2 py-2 text-gray-400 hover:text-gray-700"
          aria-label="Close search"
        >
          ✕
        </button>
      </form>

      {(results || error) && (
        <div className="absolute left-0 right-0 top-full mt-1 overflow-hidden rounded-lg bg-white/95 shadow-lg backdrop-blur">
          {error && <p className="px-3 py-2 text-sm text-red-600">Search failed: {error}</p>}
          {results && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500">No results.</p>
          )}
          {results && results.length > 0 && (
            <ul className="max-h-72 overflow-y-auto">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    // mousedown so selection wins over any blur handling
                    onMouseDown={() => {
                      goTo(r);
                      setResults(null);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-emerald-50"
                  >
                    <span className="block truncate">{r.display_name}</span>
                    {r.type && <span className="text-xs text-gray-400">{r.type}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-gray-100 px-3 py-1 text-right text-[10px] text-gray-400">
            Search © OpenStreetMap / Nominatim
          </p>
        </div>
      )}
    </div>
  );
}
