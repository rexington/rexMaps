import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parseMapPayload } from "@/lib/savedMaps";

export async function GET() {
  const { env } = getCloudflareContext();
  const { results } = await env.DB.prepare(
    "SELECT id, title, updated_at FROM maps ORDER BY updated_at DESC",
  ).all();
  return Response.json(results);
}

export async function POST(req: Request) {
  const parsed = parseMapPayload(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "invalid payload" }, { status: 400 });

  const { env } = getCloudflareContext();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO maps (id, title, data) VALUES (?1, ?2, ?3)")
    .bind(id, parsed.title, JSON.stringify(parsed.data))
    .run();
  return Response.json({ id }, { status: 201 });
}
