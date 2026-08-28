import type { ActiveLayer } from "./layers/types";
import type { MapObject } from "./objects";
import type { Viewport } from "@/store/mapStore";

/** The JSON snapshot stored per saved map (the `data` column in D1). */
export interface SavedMapData {
  objects: MapObject[];
  stack: ActiveLayer[];
  viewport: Viewport;
}

export interface SavedMapSummary {
  id: string;
  title: string;
  updated_at: number;
  is_public: number;
}

/** Server-side validation (light — a trusted family pool behind in-app session auth). */
export function parseMapPayload(
  body: unknown,
): { title: string; data: SavedMapData } | null {
  if (typeof body !== "object" || body === null) return null;
  const { title, data } = body as { title?: unknown; data?: unknown };
  if (typeof title !== "string" || title.length === 0 || title.length > 200)
    return null;
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.objects) || !Array.isArray(d.stack)) return null;
  if (typeof d.viewport !== "object" || d.viewport === null) return null;
  return { title, data: d as unknown as SavedMapData };
}

/** ---------- Client fetch helpers ---------- */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const listMaps = () => api<SavedMapSummary[]>("/api/maps");

export const createMap = (title: string, data: SavedMapData) =>
  api<{ id: string }>("/api/maps", {
    method: "POST",
    body: JSON.stringify({ title, data }),
  });

export const getMap = (id: string) =>
  api<{ id: string; title: string; data: SavedMapData }>(`/api/maps/${id}`);

export const updateMap = (id: string, title: string, data: SavedMapData) =>
  api<{ ok: true }>(`/api/maps/${id}`, {
    method: "PUT",
    body: JSON.stringify({ title, data }),
  });

export const deleteMap = (id: string) =>
  api<{ ok: true }>(`/api/maps/${id}`, { method: "DELETE" });

/** Toggles a map's public visibility only — deliberately separate from
 * updateMap so sharing/unsharing never touches (or depends on) whatever
 * content is currently loaded locally. See docs/PLAN.md. */
export const setMapPublic = (id: string, isPublic: boolean) =>
  api<{ ok: true }>(`/api/maps/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isPublic }),
  });
