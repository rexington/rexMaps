import type { CustomOverlayDef } from "./layers/customOverlay";

/** What the client sends to create one — server assigns id/owner. */
export interface CustomOverlayInput {
  name: string;
  url: string;
  typeName: string;
  color: string;
  labelField?: string;
  /** Comma-separated WFS PROPERTYNAME list; undefined = every field. */
  propertyNames?: string;
}

/** Splits on commas, trims each entry, drops empties, rejoins with bare
 * commas — so "SummitCode, SummitName" and "SummitCode,SummitName" store
 * and query identically, and a URLSearchParams-encoded space never ends up
 * inside a field name the server then fails to recognize. */
function normalizePropertyNames(raw: string): string | undefined {
  const fields = raw
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  return fields.length ? fields.join(",") : undefined;
}

/**
 * Validates a create payload. Shared between the API route (the real
 * boundary — a signed-in family member can POST here directly, so this is
 * not optional) and the add-overlay form (so the https-only check exists in
 * exactly one place).
 */
export function parseCustomOverlayInput(body: unknown): CustomOverlayInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, url, typeName, color, labelField, propertyNames } = body as Record<
    string,
    unknown
  >;

  if (typeof name !== "string" || !name.trim() || name.length > 200) return null;
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    if (new URL(url.trim()).protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (typeof typeName !== "string" || !typeName.trim()) return null;
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  if (labelField !== undefined && typeof labelField !== "string") return null;
  if (propertyNames !== undefined && typeof propertyNames !== "string") return null;
  if (typeof propertyNames === "string" && propertyNames.length > 500) return null;

  return {
    name: name.trim(),
    url: url.trim(),
    typeName: typeName.trim(),
    color,
    labelField: labelField?.trim() || undefined,
    propertyNames:
      typeof propertyNames === "string" ? normalizePropertyNames(propertyNames) : undefined,
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} → HTTP ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const listCustomOverlays = () => api<CustomOverlayDef[]>("/api/custom-overlays");

export const createCustomOverlay = (input: CustomOverlayInput) =>
  api<CustomOverlayDef>("/api/custom-overlays", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteCustomOverlay = (id: string) =>
  api<{ ok: true }>(`/api/custom-overlays/${id}`, { method: "DELETE" });
