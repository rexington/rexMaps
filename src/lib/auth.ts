import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * In-app auth, replacing Cloudflare Access as the user-facing gate — Access
 * is an all-or-nothing edge switch: no way to let one map's view route
 * through while keeping everything else behind it, and no route to
 * self-serve signup (see docs/PLAN.md decision log, 2026-08-28). Sign-in is
 * Google OpenID Connect; this file verifies the ID token and manages the
 * app's own D1-backed sessions from there. Same JWT-verification shape as
 * the Access identity check this replaced (`createRemoteJWKSet` + `jwtVerify`
 * against a live JWKS, checking iss/aud) — now pointed at Google's JWKS
 * instead of Access's own (that code is gone; Access itself was turned off
 * 2026-08-28 once this was verified live).
 */

export interface AuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * Comma-separated allowlist, checked once at first sign-in — an existing
   * session isn't re-checked against it on every request. An entry starting
   * with "@" matches any address on that domain, mirroring the Access
   * policy this replaces (which allowed the whole vokey.org domain, not one
   * address), so swapping auth mechanisms doesn't quietly narrow who can
   * sign in.
   */
  AUTH_ALLOWED_EMAILS?: string;
}

export interface SessionUser {
  id: string;
  email: string;
}

export const SESSION_COOKIE = "rexmaps_session";
const STATE_COOKIE = "rexmaps_oauth_state";
const SESSION_TTL_DAYS = 30;

let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getGoogleJwks() {
  if (!googleJwks) {
    googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  }
  return googleJwks;
}

/**
 * Verifies a Google-issued OpenID Connect ID token — signature against
 * Google's own JWKS, issuer, and that it was issued for this app's client
 * ID — rather than decoding and trusting the payload.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(idToken, getGoogleJwks(), {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email || payload.email_verified !== true) return null;
    return { email: email.toLowerCase() };
  } catch (err) {
    // First debugging signal if the client ID is wrong or a forged/expired
    // token shows up — jose's error names distinguish the cause (e.g.
    // JWTClaimValidationFailed naming "aud" vs a signature failure).
    console.warn("Google ID token verification failed", err);
    return null;
  }
}

export function isAllowedEmail(email: string, env: AuthEnv): boolean {
  const entries = (env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const lower = email.toLowerCase();
  return entries.some((entry) => (entry.startsWith("@") ? lower.endsWith(entry) : lower === entry));
}

/** Finds or creates the user row for this email, then issues a new session. */
export async function createSession(
  env: AuthEnv,
  email: string,
): Promise<{ id: string; expiresAt: number }> {
  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, email) VALUES (?1, ?2)").bind(id, email).run();
    user = { id };
  }
  const sessionId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 24 * 60 * 60;
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(sessionId, user.id, expiresAt)
    .run();
  return { id: sessionId, expiresAt };
}

export async function destroySession(env: AuthEnv, sessionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(sessionId).run();
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * The signed-in user for this request, from the session cookie — or null if
 * there isn't one, it's unrecognized, or it's expired. Callers on routes
 * that require sign-in should 401 on null, same as the accessIdentity()
 * pattern this replaces.
 */
export async function sessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT users.id as id, users.email as email FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?1 AND sessions.expires_at > unixepoch()`,
  )
    .bind(sessionId)
    .first<SessionUser>();
  return row ?? null;
}

export function readOAuthState(request: Request): string | null {
  return readCookie(request, STATE_COOKIE);
}

function cookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds?: number; expiresUnix?: number; clear?: boolean },
): string {
  const parts = [`${name}=${opts.clear ? "" : encodeURIComponent(value)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (opts.clear) parts.push("Max-Age=0");
  else if (opts.expiresUnix) parts.push(`Expires=${new Date(opts.expiresUnix * 1000).toUTCString()}`);
  else if (opts.maxAgeSeconds) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  return parts.join("; ");
}

/** Short-lived — just long enough to survive the round trip to Google's
 * consent screen and back. */
export const oauthStateCookie = (state: string) => cookie(STATE_COOKIE, state, { maxAgeSeconds: 600 });
export const clearOAuthStateCookie = () => cookie(STATE_COOKIE, "", { clear: true });
export const sessionCookie = (sessionId: string, expiresAt: number) =>
  cookie(SESSION_COOKIE, sessionId, { expiresUnix: expiresAt });
export const clearSessionCookie = () => cookie(SESSION_COOKIE, "", { clear: true });
