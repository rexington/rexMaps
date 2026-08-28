import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await env.DB.prepare("DELETE FROM custom_overlays WHERE id = ?1 AND owner = ?2")
    .bind(id, user.email)
    .run();
  if (!result.meta.changes) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
