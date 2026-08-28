"use client";

import { useEffect } from "react";
import { useMapStore, loadAuthUser } from "@/store/mapStore";

/**
 * Gates the whole app behind sign-in. Necessary now that Cloudflare Access
 * no longer fronts every request during the auth migration (see
 * docs/PLAN.md) — `/` is reachable by anyone, so the app itself has to
 * check for a session and refuse to render the editor without one. Not a
 * landing/marketing page (that's explicitly deferred) — just an in-app
 * branch on auth state.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const authUser = useMapStore((s) => s.authUser);
  const authChecked = useMapStore((s) => s.authChecked);

  useEffect(() => {
    loadAuthUser();
  }, []);

  if (!authChecked) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-gray-100 text-gray-500">
        Loading…
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-gray-100 px-4 text-center">
        <h1 className="text-xl font-semibold text-gray-900">rexMaps</h1>
        <p className="max-w-sm text-sm text-gray-500">
          Personal backcountry mapping — sign in to continue.
        </p>
        <a
          href="/api/auth/login"
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Sign in with Google
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
