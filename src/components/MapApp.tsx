"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser; skip SSR entirely.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full items-center justify-center bg-gray-100 text-gray-500">
      Loading map…
    </div>
  ),
});

export default function MapApp() {
  return <MapView />;
}
