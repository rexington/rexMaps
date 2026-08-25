/**
 * Google Map Tiles API session handling (client-side).
 *
 * Sessions are created with the public (referrer-restricted) API key and are
 * valid ~2 weeks; we cache them in localStorage and refresh a day early.
 * Terms: tiles may not be cached server-side or downloaded for offline use.
 */

const SESSION_URL = "https://tile.googleapis.com/v1/createSession";
const TILE_URL = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}";

export type GoogleMapType = "satellite" | "roadmap";

interface CachedSession {
  session: string;
  /** Unix seconds */
  expiry: number;
}

export function googleApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || undefined;
}

function cacheKey(mapType: GoogleMapType) {
  return `rexmaps:google-session:${mapType}`;
}

function readCache(mapType: GoogleMapType): CachedSession | null {
  try {
    const raw = localStorage.getItem(cacheKey(mapType));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    // Refresh a day before actual expiry.
    if (parsed.expiry - 86400 < Date.now() / 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

const inflight = new Map<GoogleMapType, Promise<string | null>>();

async function createSession(
  mapType: GoogleMapType,
  key: string,
): Promise<string | null> {
  const res = await fetch(`${SESSION_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType, language: "en-US", region: "US" }),
  });
  if (!res.ok) {
    console.error(`Google createSession failed (${res.status})`, await res.text());
    return null;
  }
  const data = (await res.json()) as { session: string; expiry: string | number };
  const cached: CachedSession = {
    session: data.session,
    expiry: Number(data.expiry),
  };
  try {
    localStorage.setItem(cacheKey(mapType), JSON.stringify(cached));
  } catch {
    // localStorage unavailable — session still usable for this page load
  }
  return cached.session;
}

/** Resolve XYZ tile URLs for a Google layer, or null when no key is set. */
export async function googleTileUrls(
  mapType: GoogleMapType,
): Promise<string[] | null> {
  const key = googleApiKey();
  if (!key) return null;

  const cached = readCache(mapType);
  let session = cached?.session ?? null;
  if (!session) {
    let pending = inflight.get(mapType);
    if (!pending) {
      pending = createSession(mapType, key).finally(() =>
        inflight.delete(mapType),
      );
      inflight.set(mapType, pending);
    }
    session = await pending;
  }
  if (!session) return null;
  return [
    `${TILE_URL}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`,
  ];
}
