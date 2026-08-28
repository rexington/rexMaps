import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sessionUser } from "@/lib/auth";

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const user = await sessionUser(req, env);
  return Response.json({ user });
}
