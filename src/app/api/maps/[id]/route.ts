import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parseMapPayload } from "@/lib/savedMaps";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { env } = getCloudflareContext();
  const row = await env.DB.prepare(
    "SELECT id, title, data, updated_at FROM maps WHERE id = ?1",
  )
    .bind(id)
    .first<{ id: string; title: string; data: string; updated_at: number }>();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...row, data: JSON.parse(row.data) });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = parseMapPayload(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "invalid payload" }, { status: 400 });

  const { env } = getCloudflareContext();
  const result = await env.DB.prepare(
    "UPDATE maps SET title = ?2, data = ?3, updated_at = unixepoch() WHERE id = ?1",
  )
    .bind(id, parsed.title, JSON.stringify(parsed.data))
    .run();
  if (result.meta.changes === 0)
    return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { env } = getCloudflareContext();
  await env.DB.prepare("DELETE FROM maps WHERE id = ?1").bind(id).run();
  return Response.json({ ok: true });
}
