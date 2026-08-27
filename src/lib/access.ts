import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessEnv {
  /** e.g. "myteam.cloudflareaccess.com" — no scheme. */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** AUD tag of the rexmaps Access application. */
  CF_ACCESS_AUD?: string;
  /**
   * Local-only escape hatch: skips JWT verification entirely and returns
   * this value as the identity. Cloudflare Access is an edge product — it
   * never sits in front of `next dev` or `opennextjs-cloudflare preview`,
   * so there's no real JWT to verify locally. Set via .dev.vars only; must
   * never appear in wrangler.jsonc's vars or as a deployed secret, or the
   * deployed Worker would trust any request as this identity.
   */
  CF_ACCESS_DEV_IDENTITY?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksForDomain: string | null = null;

function getJwks(teamDomain: string) {
  if (!jwks || jwksForDomain !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksForDomain = teamDomain;
  }
  return jwks;
}

/**
 * The authenticated identity for this request, per Cloudflare Access.
 * Cryptographically verifies the Cf-Access-Jwt-Assertion JWT — signature
 * against Access's own JWKS, plus issuer/audience claims — rather than
 * trusting the Cf-Access-Authenticated-User-Email header alone, which is
 * unauthenticated data as far as the Worker can tell on its own.
 * Returns null when unauthenticated or misconfigured; callers should 401.
 */
export async function accessIdentity(request: Request, env: AccessEnv): Promise<string | null> {
  if (env.CF_ACCESS_DEV_IDENTITY) return env.CF_ACCESS_DEV_IDENTITY;

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(env.CF_ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: env.CF_ACCESS_AUD,
    });
    return typeof payload.email === "string" ? payload.email : null;
  } catch (err) {
    // Never seen a real token yet (Access can't front local dev/preview) —
    // this log is the first debugging signal if the deployed team domain or
    // AUD is wrong. jose's error names distinguish the cause, e.g.
    // JWTClaimValidationFailed with "iss"/"aud" in the message vs a
    // signature/expiry failure vs the token just being malformed.
    console.warn("Access JWT verification failed", err);
    return null;
  }
}
