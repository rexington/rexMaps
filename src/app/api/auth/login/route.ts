import { getCloudflareContext } from "@opennextjs/cloudflare";
import { oauthStateCookie } from "@/lib/auth";

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const state = crypto.randomUUID();
  const redirectUri = new URL("/api/auth/callback/google", req.url).toString();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": oauthStateCookie(state),
    },
  });
}
