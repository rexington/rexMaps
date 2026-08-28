import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { parseMapPayload } from "@/lib/savedMaps";

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { results } = await env.DB.prepare(
    "SELECT id, title, updated_at, is_public FROM maps ORDER BY updated_at DESC",
  ).all();
  return Response.json(results);
}

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = parseMapPayload(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "invalid payload" }, { status: 400 });

  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO maps (id, title, data, owner) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, parsed.title, JSON.stringify(parsed.data), user.email)
    .run();
  return Response.json({ id }, { status: 201 });
}
