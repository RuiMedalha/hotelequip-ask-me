import {
  DIRECTUS_COLLECTIONS,
  directusRequest,
  readDirectusItem,
  readDirectusList,
} from "@/integrations/directus/client";
import type { DirectusContactPayload, DirectusSingleItemResponse } from "@/types/directus";

export async function createContact(
  payload: DirectusContactPayload,
): Promise<DirectusSingleItemResponse<Record<string, unknown>>> {
  const collection = DIRECTUS_COLLECTIONS.contacts;
  return directusRequest<DirectusSingleItemResponse<Record<string, unknown>>>(
    `/items/${encodeURIComponent(collection)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function updateContact(
  id: string,
  payload: DirectusContactPayload,
): Promise<DirectusSingleItemResponse<Record<string, unknown>>> {
  const collection = DIRECTUS_COLLECTIONS.contacts;
  return directusRequest<DirectusSingleItemResponse<Record<string, unknown>>>(
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export async function getContact(id: string): Promise<Record<string, unknown> | null> {
  const collection = DIRECTUS_COLLECTIONS.contacts;
  return readDirectusItem<Record<string, unknown>>(
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
  );
}

export async function findContactByEmail(email: string): Promise<Record<string, unknown> | null> {
  const collection = DIRECTUS_COLLECTIONS.contacts;
  const normalized = email.trim().toLowerCase();
  const qs = new URLSearchParams();
  qs.set("filter[email][_eq]", normalized);
  qs.set("limit", "1");
  const rows = await readDirectusList<Record<string, unknown>>(
    `/items/${encodeURIComponent(collection)}?${qs.toString()}`,
  );
  return rows[0] ?? null;
}

export async function findContactByPhone(phone: string): Promise<Record<string, unknown> | null> {
  const collection = DIRECTUS_COLLECTIONS.contacts;
  const qs = new URLSearchParams();
  qs.set("filter[_or][0][phone][_eq]", phone);
  qs.set("filter[_or][1][whatsapp_number][_eq]", phone);
  qs.set("limit", "1");
  const rows = await readDirectusList<Record<string, unknown>>(
    `/items/${encodeURIComponent(collection)}?${qs.toString()}`,
  );
  return rows[0] ?? null;
}
