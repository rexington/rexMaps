import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessIdentity } from "@/lib/access";
import { parseCustomOverlayInput } from "@/lib/customOverlaysApi";
import type { CustomOverlayDef } from "@/lib/layers/customOverlay";

type Row = {
  id: string;
  name: string;
  url: string;
  type_name: string;
  color: string;
  label_field: string | null;
  property_names: string | null;
};

function toDef(row: Row): CustomOverlayDef {
  return {
    id: row.id,
    kind: "feature-query",
    protocol: "wfs",
    name: row.name,
    url: row.url,
    typeName: row.type_name,
    color: row.color,
    labelField: row.label_field ?? undefined,
    propertyNames: row.property_names ?? undefined,
  };
}

export async function GET(req: Request) {
  const { env } = getCloudflareContext();
  const owner = await accessIdentity(req, env);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { results } = await env.DB.prepare(
    "SELECT id, name, url, type_name, color, label_field, property_names FROM custom_overlays WHERE owner = ?1 ORDER BY created_at",
  )
    .bind(owner)
    .all<Row>();

  return Response.json(results.map(toDef));
}

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const owner = await accessIdentity(req, env);
  if (!owner) return Response.json({ error: "unauthorized" }, { status: 401 });

  const input = parseCustomOverlayInput(await req.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid payload" }, { status: 400 });

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO custom_overlays (id, owner, name, url, type_name, color, label_field, property_names) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
  )
    .bind(
      id,
      owner,
      input.name,
      input.url,
      input.typeName,
      input.color,
      input.labelField ?? null,
      input.propertyNames ?? null,
    )
    .run();

  return Response.json(
    toDef({
      id,
      name: input.name,
      url: input.url,
      type_name: input.typeName,
      color: input.color,
      label_field: input.labelField ?? null,
      property_names: input.propertyNames ?? null,
    }),
    { status: 201 },
  );
}
