import { getCloudflareContext } from "@opennextjs/cloudflare";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The one route in the app that's deliberately, intentionally public — no
 * sessionUser() check, by design. Real authorization still happens here,
 * just as a query condition rather than a session check: `is_public = 1` is
 * checked server-side regardless of what the id looks like, so a private
 * map's id being guessable (it isn't — crypto.randomUUID()) still wouldn't
 * expose it. 404 either way a map isn't servable (missing vs. private) so
 * this can't be used to probe which ids exist.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { env } = getCloudflareContext();
  const { id } = await ctx.params;
  const row = await env.DB.prepare(
    "SELECT id, title, data FROM maps WHERE id = ?1 AND is_public = 1",
  )
    .bind(id)
    .first<{ id: string; title: string; data: string }>();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ id: row.id, title: row.title, data: JSON.parse(row.data) });
}
