import PublicMapApp from "@/components/PublicMapApp";

// See src/app/page.tsx for why: this shell has no real server-side data
// dependency either (the map's data is fetched client-side), so it'd
// otherwise get a 1-year edge cache with no purge-on-deploy safety net.
export const dynamic = "force-dynamic";

export default async function Page({ params }: PageProps<"/m/[id]">) {
  const { id } = await params;
  return <PublicMapApp id={id} />;
}
