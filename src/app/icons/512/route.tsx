import { ImageResponse } from "next/og";
import { mountainGlyph } from "@/lib/appIcon";

// Stable path (unlike /icon, which Next suffixes with a cache-busting query)
// for the web manifest's icons array, which needs a fixed src per size.
export async function GET() {
  return new ImageResponse(mountainGlyph(512, 96), { width: 512, height: 512 });
}
