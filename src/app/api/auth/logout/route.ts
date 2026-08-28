import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SESSION_COOKIE, clearSessionCookie, destroySession, readCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (sessionId) await destroySession(env, sessionId);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie() } });
}
