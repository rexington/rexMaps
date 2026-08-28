import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  clearOAuthStateCookie,
  createSession,
  isAllowedEmail,
  readOAuthState,
  sessionCookie,
  verifyGoogleIdToken,
} from "@/lib/auth";

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readOAuthState(req);

  // The state cookie is short-lived (10 min) and single-use by design — a
  // missing/mismatched value means an expired or replayed callback, not
  // something to guess-and-continue past.
  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response("Sign-in failed: invalid or expired state. Try again.", { status: 400 });
  }

  const redirectUri = new URL("/api/auth/callback/google", req.url).toString();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.warn("Google token exchange failed", tokenRes.status, await tokenRes.text().catch(() => ""));
    return new Response("Sign-in failed: Google token exchange error.", { status: 502 });
  }
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return new Response("Sign-in failed: no ID token from Google.", { status: 502 });

  const identity = await verifyGoogleIdToken(id_token, env.GOOGLE_CLIENT_ID);
  if (!identity) return new Response("Sign-in failed: could not verify identity.", { status: 401 });
  if (!isAllowedEmail(identity.email, env)) {
    return new Response(`${identity.email} is not authorized for rexMaps.`, { status: 403 });
  }

  const session = await createSession(env, identity.email);
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", sessionCookie(session.id, session.expiresAt));
  headers.append("Set-Cookie", clearOAuthStateCookie());
  return new Response(null, { status: 302, headers });
}
