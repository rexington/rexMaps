import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";
import { parseMapPayload } from "@/lib/savedMaps";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const row = await env.DB.prepare(
    "SELECT id, title, data, updated_at, is_public FROM maps WHERE id = ?1",
  )
    .bind(id)
    .first<{ id: string; title: string; data: string; updated_at: number; is_public: number }>();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...row, data: JSON.parse(row.data) });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = parseMapPayload(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "invalid payload" }, { status: 400 });

  const result = await env.DB.prepare(
    "UPDATE maps SET title = ?2, data = ?3, updated_at = unixepoch() WHERE id = ?1",
  )
    .bind(id, parsed.title, JSON.stringify(parsed.data))
    .run();
  if (result.meta.changes === 0)
    return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

/** Toggles public visibility only — deliberately separate from PUT so
 * sharing/unsharing a map never depends on (or overwrites with) whatever
 * content happens to be loaded locally at the time. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { isPublic?: unknown } | null;
  if (!body || typeof body.isPublic !== "boolean")
    return Response.json({ error: "invalid payload" }, { status: 400 });

  const result = await env.DB.prepare("UPDATE maps SET is_public = ?2 WHERE id = ?1")
    .bind(id, body.isPublic ? 1 : 0)
    .run();
  if (result.meta.changes === 0)
    return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  await env.DB.prepare("DELETE FROM maps WHERE id = ?1").bind(id).run();
  return Response.json({ ok: true });
}
