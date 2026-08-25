// rexMaps service worker — hand-rolled, no bundler/build step (Turbopack
// already broke one third-party worker in this app; a plugin like next-pwa
// would be the same risk again). Registered by ServiceWorkerRegister.tsx,
// production builds only. Design notes: docs/PLAN.md Stage 6.

const SHELL_CACHE = "rexmaps-shell-v1";
// Tile packs are large and precious — never cleared just because a new app
// build shipped, only pruned by the user via the offline-areas UI.
const TILE_CACHE = "rexmaps-tiles-v1";

// Flip to true and redeploy to remotely kill a bad SW on installed devices:
// every request passes straight through and all caches (including tiles) are
// dropped on the next activate. There is no other remote-recovery path for a
// service worker stuck on someone's phone.
const KILL_SWITCH = false;

// Evergreen basemap/terrain tile hosts — safe to cache-first indefinitely.
// Deliberately NOT here: tile.googleapis.com (ToS forbids caching), Sentinel
// (its tile URLs embed today's date and are never requested again), BRouter/
// Nominatim/D1 (dynamic, per-query).
const CACHE_FIRST_HOSTS = [
  "tiles.openfreemap.org", // style + TileJSON + tiles + glyphs + sprite, one host
  "arcgisonline.com", // server.* (imagery) and services.* (hillshade)
  "basemap.nationalmap.gov", // USGS
  "tiles.arcgis.com", // USFS Forest Service Basemap
];

function isCacheFirstHost(url) {
  return CACHE_FIRST_HOSTS.some(
    (h) => url.host === h || url.host.endsWith(`.${h}`),
  );
}

function isTerrariumDem(url) {
  return (
    url.host === "s3.amazonaws.com" &&
    url.pathname.startsWith("/elevation-tiles-prod/")
  );
}

function isNeverCache(url) {
  if (url.host === "tile.googleapis.com") return true;
  if (
    url.host === self.location.host &&
    (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/"))
  )
    return true;
  return false;
}

function isShellAsset(url) {
  return (
    url.host === self.location.host &&
    (/^\/_next\/static\//.test(url.pathname) ||
      /\.(mjs|woff2?)$/.test(url.pathname))
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (KILL_SWITCH) {
        for (const name of await caches.keys()) await caches.delete(name);
        await self.registration.unregister();
        await self.clients.claim();
        return;
      }
      for (const name of await caches.keys()) {
        if (name.startsWith("rexmaps-shell-") && name !== SHELL_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (KILL_SWITCH) return;
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isNeverCache(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(req));
    return;
  }
  if (isCacheFirstHost(url) || isTerrariumDem(url)) {
    event.respondWith(cacheFirst(req, TILE_CACHE));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  // Everything else (BRouter, Nominatim, CDSE WFS, the app's own /api/*
  // already excluded above) is left to the network untouched.
});

async function handleNavigate(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    // Only trust a same-origin, non-redirected 200 as "the app shell". A
    // lapsed Cloudflare Access session serves its login page at this same
    // URL via a redirect — caching THAT as "/" would brick offline use until
    // the user manually clears site data. Still return it to the browser so
    // sign-in works normally; just don't cache it.
    if (res.ok && !res.redirected && new URL(res.url).host === self.location.host) {
      cache.put("/", res.clone());
    }
    return res;
  } catch {
    const cached = await cache.match("/");
    return cached || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // A response lacking CORS (opaque) can still be cached and replayed, just
  // not inspected — only skip caching real, observable failures.
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
