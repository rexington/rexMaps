import { ImageResponse } from "next/og";
import { mountainGlyph } from "@/lib/appIcon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS applies its own corner rounding to apple-touch-icons, so radius 0 here
// (unlike icon.tsx, which needs its own rounding for other contexts).
export default function AppleIcon() {
  return new ImageResponse(mountainGlyph(180, 0), size);
}
