const EMERALD = "#047857";

/**
 * Shared glyph for icon.tsx / apple-icon.tsx / the manifest icon routes.
 * Satori (ImageResponse's renderer) doesn't produce real triangles from the
 * classic CSS border trick — it just paints a rectangle — so the peak is an
 * inline SVG polygon instead, which Satori does support.
 */
export function mountainGlyph(px: number, radius: number) {
  const glyph = Math.round(px * 0.6);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: EMERALD,
        borderRadius: radius,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 100 100">
        <polygon points="50,18 88,82 12,82" fill="white" />
      </svg>
    </div>
  );
}
