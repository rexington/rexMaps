import { setWorkerCount, setWorkerUrl, type Map as MaplibreMap } from "maplibre-gl";

/**
 * One-time MapLibre worker setup, shared by MapView and PublicMapView.
 * Call at module level — both settings must be in place before the first
 * map is constructed (the worker pool is created lazily, once).
 */
export function configureMapWorkers() {
  // Self-hosted worker (copied to public/ on postinstall) — Turbopack breaks
  // maplibre's own worker URL, which silently disables all vector tile loading.
  setWorkerUrl("/maplibre-gl-worker.mjs");
  // MapLibre defaults to 1 worker everywhere except Safari (up to 3). On an
  // iPhone home-screen app launched cold while offline, the 2nd worker
  // intermittently never boots — confirmed 2026-09-28 by pinging each worker
  // from Web Inspector: Worker 0 alive, Worker 1 silent, and every source
  // assigned to it (the drawn-objects GeoJSON, some vector tiles) stuck
  // loading forever with no error. A ⌘R reload (service worker already
  // running) always recovered. Chrome's single worker never hit it.
  setWorkerCount(1);
}

// Internals used only for the health ping below. Not public API, so every
// access is optional — if a MapLibre upgrade renames them the watchdog just
// does nothing rather than breaking the map.
type Actor = { sendAsync(msg: { type: string; data: unknown }): Promise<unknown> };
type Dispatcher = { actorsPromise?: Promise<Actor[]> };

const RELOAD_KEY = "rexmaps:worker-watchdog-reload";
const RELOAD_COOLDOWN_MS = 60_000;
const PING_TIMEOUT_MS = 5_000;

/**
 * Safety net for the dead-worker failure above, should it still occur with a
 * single worker: a worker that never boots answers nothing, so the map sits
 * half (or, with one worker, fully) unrendered with no error. Shortly after
 * startup, ping every worker once; if any stays silent, reload the page —
 * the one recovery observed to work. At most one watchdog reload per minute,
 * so a persistent failure can't loop. Returns a cancel for effect cleanup.
 */
export function watchMapWorkers(map: MaplibreMap): () => void {
  const timer = setTimeout(async () => {
    const dispatcher = (map as unknown as { style?: { dispatcher?: Dispatcher } }).style
      ?.dispatcher;
    const actors = await dispatcher?.actorsPromise?.catch(() => undefined);
    if (!actors?.length) return;
    // "SR" (set referrer) is MapLibre's own no-op-ish message; resending the
    // value it already broadcasts on style load changes nothing.
    const results = await Promise.all(
      actors.map((a) =>
        Promise.race([
          a.sendAsync({ type: "SR", data: window.location.href }).then(
            () => true,
            () => true, // an error reply still proves the worker is alive
          ),
          new Promise<boolean>((r) => setTimeout(() => r(false), PING_TIMEOUT_MS)),
        ]),
      ),
    );
    if (results.every(Boolean)) return;

    // No storage = no loop guard = don't auto-reload at all.
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
      if (Date.now() - last < RELOAD_COOLDOWN_MS) {
        console.error("MapLibre worker unresponsive; already reloaded recently, not retrying");
        return;
      }
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      console.error("MapLibre worker unresponsive; can't guard a reload, not reloading");
      return;
    }
    console.error("MapLibre worker unresponsive; reloading");
    window.location.reload();
  }, 3_000);
  return () => clearTimeout(timer);
}
