export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Result of checking the session cookie against the server. `/api/auth/me`
 * always 200s with `{user}` when reachable (see src/app/api/auth/me/route.ts)
 * — so a thrown fetch means the network is unreachable, not that there's no
 * session. Collapsing that into "signed out" is what broke offline use: a
 * device with a perfectly valid session cookie got shown the sign-in screen
 * the moment it lost connectivity, since the *check* needs network even
 * though the rest of the app (cached shell, downloaded tiles, local drawing)
 * doesn't. Callers must handle "offline" separately from "signed out" —
 * see loadAuthUser().
 */
export type SessionCheck =
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out" }
  | { status: "offline" };

export async function checkSession(): Promise<SessionCheck> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return { status: "signed-out" };
    const body = (await res.json()) as { user: SessionUser | null };
    return body.user ? { status: "signed-in", user: body.user } : { status: "signed-out" };
  } catch {
    return { status: "offline" };
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
