"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser; skip SSR entirely — same reason and same
// shape as MapApp.tsx (dynamic({ssr:false}) has to be called from a Client
// Component, not the Server Component page itself).
const PublicMapView = dynamic(() => import("./PublicMapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full items-center justify-center bg-gray-100 text-gray-500">
      Loading map…
    </div>
  ),
});

export default function PublicMapApp({ id }: { id: string }) {
  return <PublicMapView id={id} />;
}
