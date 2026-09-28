import type { GeolocateControl, IControl, Map as MaplibreMap } from "maplibre-gl";
import { angleDiff, requestCompassPermission, watchCompass } from "./heading";

/** Current zoom level, e.g. "z13.4", shown beside the scale bar. */
export class ZoomLevelControl implements IControl {
  private el?: HTMLDivElement;
  private map?: MaplibreMap;
  private update = () => {
    if (this.el && this.map) this.el.textContent = `z${this.map.getZoom().toFixed(1)}`;
  };

  onAdd(map: MaplibreMap) {
    this.map = map;
    this.el = document.createElement("div");
    // Reuses the scale bar's look; `clear: none` lets it sit on the same row
    // (bottom-corner controls otherwise stack, one per line).
    this.el.className = "maplibregl-ctrl maplibregl-ctrl-scale";
    this.el.style.clear = "none";
    this.el.style.borderTop = "2px solid #333";
    this.el.title = "Zoom level";
    map.on("zoom", this.update);
    this.update();
    return this.el;
  }

  onRemove() {
    this.map?.off("zoom", this.update);
    this.el?.remove();
  }
}

const NORTH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path d="M12 3 16 12H8z" fill="#dc2626"/><path d="M12 21 8 12h8z" fill="#9ca3af"/></svg>`;
const HEADING_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path d="M12 3 19 20 12 16 5 20z" fill="#2563eb"/></svg>`;

// Speed (m/s) above which the GPS course is trusted as a heading fallback.
const MIN_COURSE_SPEED = 0.5;
// How long a compass reading stays authoritative over the GPS course.
const COMPASS_FRESH_MS = 3000;

/**
 * Replaces NavigationControl's compass. One button, three states:
 *   rotated  → tap resets to north-up (needle shows where north is)
 *   north-up → tap enters direction-up: map turns with your heading and
 *              follows your location (starts location tracking if needed)
 *   direction-up → tap returns to north-up
 * Dragging/rotating the map by hand (or turning location off) exits
 * direction-up back to north-up. Also draws a heading cone on MapLibre's
 * own location dot whenever a heading is known, in either mode.
 *
 * Heading: compass when available (iOS asks permission on first location
 * or button tap), else GPS course while moving.
 */
export class HeadingModeControl implements IControl {
  private map?: MaplibreMap;
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private cone?: HTMLDivElement;
  private mode: "north" | "heading" = "north";
  private heading: number | null = null;
  private compassAt = 0;
  private lastPos: [number, number] | null = null;
  private locked = false;
  private userZooming = false;
  private frame = 0;
  private stopCompass?: () => void;
  private offs: (() => void)[] = [];

  constructor(private geolocate: GeolocateControl) {}

  onAdd(map: MaplibreMap) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.style.display = "flex";
    this.button.style.alignItems = "center";
    this.button.style.justifyContent = "center";
    this.button.addEventListener("click", this.onClick);
    this.container.appendChild(this.button);

    const g = this.geolocate;
    const onPos = (e: { coords: GeolocationCoordinates }) => this.onPosition(e.coords);
    const onStart = () => (this.locked = true);
    const onEnd = () => {
      this.locked = false;
      if (this.mode === "heading") this.exitHeading();
    };
    g.on("geolocate", onPos);
    g.on("trackuserlocationstart", onStart);
    g.on("trackuserlocationend", onEnd);
    this.offs.push(
      () => g.off("geolocate", onPos),
      () => g.off("trackuserlocationstart", onStart),
      () => g.off("trackuserlocationend", onEnd),
    );

    // iOS only grants compass access from inside a user gesture, so ask on
    // the location button's tap too (delegated: its button is created async).
    const onContainerClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".maplibregl-ctrl-geolocate")) this.startCompass();
    };
    map.getContainer().addEventListener("click", onContainerClick, true);
    this.offs.push(() => map.getContainer().removeEventListener("click", onContainerClick, true));

    const onRotate = () => {
      this.render();
      this.updateCone();
    };
    const onRotateStart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && this.mode === "heading") this.exitHeading();
    };
    const onZoomStart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) this.userZooming = true;
    };
    const onZoomEnd = () => (this.userZooming = false);
    map.on("rotate", onRotate);
    map.on("rotatestart", onRotateStart);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    this.offs.push(
      () => map.off("rotate", onRotate),
      () => map.off("rotatestart", onRotateStart),
      () => map.off("zoomstart", onZoomStart),
      () => map.off("zoomend", onZoomEnd),
    );

    this.render();
    return this.container;
  }

  onRemove() {
    for (const off of this.offs) off();
    this.stopCompass?.();
    cancelAnimationFrame(this.frame);
    this.cone?.remove();
    this.container?.remove();
  }

  private onClick = () => {
    const map = this.map!;
    if (this.mode === "heading") {
      this.exitHeading();
    } else if (Math.abs(map.getBearing()) > 0.5 || map.getPitch() > 0.5) {
      map.easeTo({ bearing: 0, pitch: 0 });
    } else {
      this.startCompass();
      this.mode = "heading";
      // From OFF or BACKGROUND, trigger() (re)locks onto the user's location;
      // from an active lock it would turn tracking off, hence the guard.
      if (!this.locked) this.geolocate.trigger();
      this.render();
      this.schedule();
    }
  };

  private exitHeading() {
    this.mode = "north";
    this.map?.easeTo({ bearing: 0 });
    this.render();
  }

  private startCompass() {
    void requestCompassPermission();
    if (this.stopCompass) return;
    this.stopCompass = watchCompass((deg) => {
      this.compassAt = Date.now();
      this.setHeading(deg);
    });
  }

  private onPosition(c: GeolocationCoordinates) {
    this.lastPos = [c.longitude, c.latitude];
    const compassFresh = Date.now() - this.compassAt < COMPASS_FRESH_MS;
    if (
      !compassFresh &&
      c.heading !== null &&
      !Number.isNaN(c.heading) &&
      (c.speed ?? 0) >= MIN_COURSE_SPEED
    ) {
      this.setHeading(c.heading);
    }
    // Runs right after GeolocateControl started its own fitBounds for this
    // fix; in direction-up our jumpTo supersedes it (keeping the user's zoom).
    if (this.mode === "heading") this.applyCamera();
    this.updateCone();
  }

  private setHeading(deg: number) {
    this.heading = deg;
    this.updateCone();
    if (this.mode === "heading") this.schedule();
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.applyCamera();
    });
  }

  private applyCamera() {
    const map = this.map;
    if (!map || this.mode !== "heading" || !this.locked || this.userZooming) return;
    const bearing = this.heading ?? map.getBearing();
    // Skip sub-degree compass noise when the position hasn't changed.
    if (!this.lastPos) return;
    const c = map.getCenter();
    const moved = Math.abs(c.lng - this.lastPos[0]) + Math.abs(c.lat - this.lastPos[1]) > 1e-7;
    if (!moved && Math.abs(angleDiff(bearing, map.getBearing())) < 1) return;
    // geolocateSource: without it GeolocateControl treats this as the user
    // moving the camera and drops out of tracking.
    map.jumpTo({ center: this.lastPos, bearing }, { geolocateSource: true });
  }

  /** Cone attached to MapLibre's own location dot, so it shares the dot's
   * position and visibility; rotated to screen space (heading − bearing). */
  private updateCone() {
    const map = this.map;
    if (!map || this.heading === null) return;
    const dot = map.getContainer().querySelector(".maplibregl-user-location-dot");
    if (!dot) return;
    if (!this.cone || this.cone.parentElement !== dot) {
      this.cone = document.createElement("div");
      this.cone.className = "rexmaps-heading-cone";
      dot.appendChild(this.cone);
    }
    this.cone.style.transform = `translate(-50%, -100%) rotate(${this.heading - map.getBearing()}deg)`;
  }

  private render() {
    const b = this.button;
    const map = this.map;
    if (!b || !map) return;
    if (this.mode === "heading") {
      b.innerHTML = HEADING_ICON;
      b.title = "Direction up — tap for north up";
    } else {
      b.innerHTML = NORTH_ICON;
      const bearing = map.getBearing();
      (b.firstElementChild as SVGElement).style.transform = `rotate(${-bearing}deg)`;
      b.title =
        Math.abs(bearing) > 0.5 || map.getPitch() > 0.5
          ? "Reset to north up"
          : "North up — tap for direction up";
    }
    b.setAttribute("aria-label", b.title);
  }
}
