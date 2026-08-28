export interface SessionUser {
  id: string;
  email: string;
}

/** Current session, or null if signed out — never throws (a failed check
 * should read as "not signed in", not surface as an error the UI has to
 * handle separately). */
export async function fetchCurrentUser(): Promise<SessionUser | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const body = (await res.json()) as { user: SessionUser | null };
    return body.user;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
