import AuthGate from "@/components/AuthGate";
import MapApp from "@/components/MapApp";

// This shell has no server-side data dependency (auth state and everything
// else is fetched client-side), so Next would otherwise treat it as a
// static page and send a 1-year s-maxage — Cloudflare's edge cache then has
// no way to know a new deploy changed the shell, since there's no
// integrated purge-on-deploy the way Vercel's own platform provides (see
// docs/PLAN.md, 2026-08-29: a viewport-meta change shipped but stayed
// invisible behind a cached copy of the old HTML until manually busted).
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <AuthGate>
      <MapApp />
    </AuthGate>
  );
}
