import type { Map as MaplibreMap } from "maplibre-gl";
import { DEFAULT_MARKER_ICON, type MapObject } from "./objects";

/**
 * Marker glyphs: a colored circular badge (matches the object's color, same
 * look as the old plain-circle marker) with a white pictogram drawn on top.
 * Rendered client-side via Canvas 2D — no icon font/SVG-sprite dependency —
 * and registered with MapLibre's image manager (`map.addImage`) so the
 * marker layer can be a `symbol` layer keyed by `icon-image`.
 *
 * `icon-size` on a symbol layer is a *scale factor* on the image's native
 * pixel size, not an absolute radius like the old `circle-radius` — see
 * ICON_SCALE_DIAMETER, which callers (objectLayers.ts) divide into the
 * desired on-map diameter to get that factor.
 */

type Drawer = (ctx: CanvasRenderingContext2D, cx: number, cy: number, g: number) => void;

const DRAWERS: Record<string, Drawer> = {
  dot: () => {
    /* badge alone — matches the original plain-circle marker */
  },
  star: (ctx, cx, cy, g) => {
    const spikes = 5;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? g : g * 0.45;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },
  camp: (ctx, cx, cy, g) => {
    ctx.beginPath();
    ctx.moveTo(cx - g, cy + g * 0.8);
    ctx.lineTo(cx, cy - g);
    ctx.lineTo(cx + g, cy + g * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - g * 0.15);
    ctx.lineTo(cx, cy + g * 0.8);
    ctx.stroke();
  },
  water: (ctx, cx, cy, g) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - g);
    ctx.bezierCurveTo(cx + g * 1.1, cy - g * 0.1, cx + g * 0.7, cy + g, cx, cy + g);
    ctx.bezierCurveTo(cx - g * 0.7, cy + g, cx - g * 1.1, cy - g * 0.1, cx, cy - g);
    ctx.closePath();
    ctx.fill();
  },
  parking: (ctx, cx, cy, g) => {
    ctx.font = `900 ${g * 1.7}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("P", cx, cy + g * 0.08);
  },
  summit: (ctx, cx, cy, g) => {
    ctx.beginPath();
    ctx.moveTo(cx - g, cy + g * 0.8);
    ctx.lineTo(cx - g * 0.1, cy - g);
    ctx.lineTo(cx + g * 0.3, cy - g * 0.3);
    ctx.lineTo(cx + g, cy + g * 0.8);
    ctx.closePath();
    ctx.fill();
  },
  viewpoint: (ctx, cx, cy, g) => {
    ctx.beginPath();
    ctx.arc(cx, cy, g * 0.35, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * g * 0.55, cy + Math.sin(a) * g * 0.55);
      ctx.lineTo(cx + Math.cos(a) * g * 0.95, cy + Math.sin(a) * g * 0.95);
      ctx.stroke();
    }
  },
  photo: (ctx, cx, cy, g) => {
    const w = g * 1.7;
    const h = g * 1.15;
    const x = cx - w / 2;
    const y = cy - h / 2 + g * 0.15;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, g * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(cx - g * 0.25, y - g * 0.32, g * 0.5, g * 0.32);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + g * 0.1, g * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  },
  danger: (ctx, cx, cy, g) => {
    ctx.lineWidth *= 1.3; // bolder outline — must read as a warning sign at a glance
    ctx.beginPath();
    ctx.moveTo(cx, cy - g);
    ctx.lineTo(cx + g * 0.95, cy + g * 0.85);
    ctx.lineTo(cx - g * 0.95, cy + g * 0.85);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth *= 1.3; // the exclamation itself thicker still
    ctx.beginPath();
    ctx.moveTo(cx, cy - g * 0.25);
    ctx.lineTo(cx, cy + g * 0.32);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + g * 0.65, g * 0.14, 0, Math.PI * 2);
    ctx.fill();
  },
  food: (ctx, cx, cy, g) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + g * 0.05);
    ctx.lineTo(cx, cy + g);
    ctx.stroke();
    for (const dx of [-g * 0.35, 0, g * 0.35]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy - g);
      ctx.lineTo(cx + dx, cy + g * 0.1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - g * 0.35, cy);
    ctx.lineTo(cx + g * 0.35, cy);
    ctx.stroke();
  },
  campfire: (ctx, cx, cy, g) => {
    // A log base underneath is what tells this apart from the water droplet
    // at a glance — the flame alone reads as the same rounded blob.
    ctx.beginPath();
    ctx.moveTo(cx - g * 0.85, cy + g * 0.55);
    ctx.lineTo(cx + g * 0.85, cy + g * 0.85);
    ctx.moveTo(cx - g * 0.85, cy + g * 0.85);
    ctx.lineTo(cx + g * 0.85, cy + g * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + g * 0.4);
    ctx.bezierCurveTo(cx - g * 0.75, cy - g * 0.05, cx - g * 0.35, cy - g * 0.55, cx - g * 0.05, cy - g);
    ctx.bezierCurveTo(cx + g * 0.05, cy - g * 0.4, cx + g * 0.4, cy - g * 0.35, cx + g * 0.1, cy,
    );
    ctx.bezierCurveTo(cx + g * 0.45, cy - g * 0.05, cx + g * 0.65, cy + g * 0.2, cx, cy + g * 0.4);
    ctx.closePath();
    ctx.fill();
  },
  flag: (ctx, cx, cy, g) => {
    ctx.beginPath();
    ctx.moveTo(cx - g * 0.5, cy - g);
    ctx.lineTo(cx - g * 0.5, cy + g);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - g * 0.5, cy - g);
    ctx.lineTo(cx + g * 0.7, cy - g * 0.55);
    ctx.lineTo(cx - g * 0.5, cy - g * 0.1);
    ctx.closePath();
    ctx.fill();
  },
};

export const MARKER_ICONS: { id: string; label: string }[] = [
  { id: "dot", label: "Plain" },
  { id: "star", label: "Star" },
  { id: "camp", label: "Camp" },
  { id: "water", label: "Water" },
  { id: "parking", label: "Parking" },
  { id: "summit", label: "Summit" },
  { id: "viewpoint", label: "Viewpoint" },
  { id: "photo", label: "Photo spot" },
  { id: "danger", label: "Danger" },
  { id: "food", label: "Food" },
  { id: "campfire", label: "Campfire" },
  { id: "flag", label: "Flag" },
];

// CSS-pixel diameter of the rendered badge at icon-size 1 (the canvas itself
// is rendered at 2x this for crispness — see drawIconToCanvas — and
// registered with pixelRatio: 2 so MapLibre accounts for that automatically).
export const ICON_SCALE_DIAMETER = 44;

function drawIconToCanvas(icon: string, color: string): HTMLCanvasElement {
  const physical = ICON_SCALE_DIAMETER * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = physical;
  const ctx = canvas.getContext("2d")!;
  const cx = physical / 2;
  const cy = physical / 2;
  const r = physical * 0.42;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = physical * 0.045;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = physical * 0.06;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  (DRAWERS[icon] ?? DRAWERS[DEFAULT_MARKER_ICON])(ctx, cx, cy, r * 0.85);

  return canvas;
}

export function iconImageKey(icon: string, color: string): string {
  return `marker-icon:${icon}:${color}`;
}

/** Small preview for the icon picker UI (not the map). */
export function iconPreviewDataUrl(icon: string, color: string): string {
  return drawIconToCanvas(icon, color).toDataURL();
}

/** Registers any (icon, color) combinations in `objects` that MapLibre's
 * image manager doesn't already have. Cheap to call liberally — checks
 * `map.hasImage()` first, so re-calling after a style rebuild or an object
 * edit only ever draws genuinely new combinations. */
export function ensureMarkerIcons(map: MaplibreMap, objects: MapObject[]): void {
  const seen = new Set<string>();
  for (const obj of objects) {
    if (obj.kind !== "marker") continue;
    const icon = obj.icon ?? DEFAULT_MARKER_ICON;
    const key = iconImageKey(icon, obj.color);
    if (seen.has(key) || map.hasImage(key)) {
      seen.add(key);
      continue;
    }
    seen.add(key);
    const canvas = drawIconToCanvas(icon, obj.color);
    const ctx = canvas.getContext("2d")!;
    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
  }
}
