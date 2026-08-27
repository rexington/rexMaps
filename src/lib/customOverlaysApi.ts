import type { CustomOverlayDef } from "./layers/customOverlay";

/** What the client sends to create one — server assigns id/owner. */
export interface CustomOverlayInput {
  name: string;
  url: string;
  typeName: string;
  color: string;
  labelField?: string;
}

/**
 * Validates a create payload. Shared between the API route (the real
 * boundary — a signed-in family member can POST here directly, so this is
 * not optional) and the add-overlay form (so the https-only check exists in
 * exactly one place).
 */
export function parseCustomOverlayInput(body: unknown): CustomOverlayInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, url, typeName, color, labelField } = body as Record<string, unknown>;

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

  return {
    name: name.trim(),
    url: url.trim(),
    typeName: typeName.trim(),
    color,
    labelField: labelField?.trim() || undefined,
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
