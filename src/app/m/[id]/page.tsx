import PublicMapApp from "@/components/PublicMapApp";

export default async function Page({ params }: PageProps<"/m/[id]">) {
  const { id } = await params;
  return <PublicMapApp id={id} />;
}
