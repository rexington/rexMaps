/**
 * Device compass heading (degrees clockwise from north), smoothed.
 *
 * iOS exposes it as `webkitCompassHeading` on `deviceorientation`, behind a
 * permission prompt that must be requested from inside a user gesture
 * (requestCompassPermission). Android/Chrome exposes an absolute `alpha` on
 * `deviceorientationabsolute` (heading = 360 − alpha). Both report relative
 * to the device's top edge, so the screen rotation angle is added.
 */

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionCapable = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Call synchronously from a click/tap handler. No-op where not required. */
export function requestCompassPermission(): Promise<boolean> {
  const req = (window.DeviceOrientationEvent as unknown as PermissionCapable | undefined)
    ?.requestPermission;
  if (!req) return Promise.resolve(true);
  return req().then(
    (r) => r === "granted",
    () => false,
  );
}

function screenAngle(): number {
  return screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
}

const norm = (d: number) => ((d % 360) + 360) % 360;
/** Signed shortest difference a − b in (−180, 180]. */
export const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/**
 * Start listening; `onHeading` gets a smoothed heading on each reading.
 * Returns a stop function. Safe to call before permission is granted on iOS
 * — events simply don't arrive until it is.
 */
export function watchCompass(onHeading: (deg: number) => void): () => void {
  let smoothed: number | null = null;
  const absolute = "ondeviceorientationabsolute" in window;
  const type = absolute ? "deviceorientationabsolute" : "deviceorientation";

  const handler = (e: Event) => {
    const ev = e as IOSOrientationEvent;
    let raw: number | null = null;
    if (typeof ev.webkitCompassHeading === "number" && !Number.isNaN(ev.webkitCompassHeading)) {
      raw = ev.webkitCompassHeading;
    } else if ((absolute || ev.absolute) && typeof ev.alpha === "number") {
      raw = 360 - ev.alpha;
    }
    if (raw === null) return;
    const h = norm(raw + screenAngle());
    // Circular low-pass: raw compass readings jitter by several degrees.
    smoothed = smoothed === null ? h : norm(smoothed + 0.25 * angleDiff(h, smoothed));
    onHeading(smoothed);
  };
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}
