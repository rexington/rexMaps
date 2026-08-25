import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "rexMaps",
    short_name: "rexMaps",
    description: "Personal backcountry mapping — routes, layers, research",
    start_url: "/",
    display: "standalone",
    background_color: "#dde3e8",
    theme_color: "#047857",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
