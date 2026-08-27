import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessIdentity } from "@/lib/access";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const owner = await accessIdentity(req, env);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await env.DB.prepare("DELETE FROM custom_overlays WHERE id = ?1 AND owner = ?2")
    .bind(id, owner)
    .run();
  if (!result.meta.changes) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
