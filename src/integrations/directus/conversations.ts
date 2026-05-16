import {
  DIRECTUS_COLLECTIONS,
  directusRequest,
  readDirectusItem,
  readDirectusList,
} from "@/integrations/directus/client";
import { getMessages } from "@/integrations/directus/messages";
import type { DirectusConversationPayload, DirectusSingleItemResponse } from "@/types/directus";

const VISITOR_FIELD =
  (import.meta.env.VITE_DIRECTUS_CONVERSATION_VISITOR_FIELD as string | undefined)?.trim()
  || "visitor_id";

export async function createConversation(
  payload: DirectusConversationPayload,
): Promise<DirectusSingleItemResponse<Record<string, unknown>>> {
  const collection = DIRECTUS_COLLECTIONS.conversations;
  return directusRequest<DirectusSingleItemResponse<Record<string, unknown>>>(
    `/items/${encodeURIComponent(collection)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function updateConversation(
  id: string,
  payload: DirectusConversationPayload,
): Promise<DirectusSingleItemResponse<Record<string, unknown>>> {
  const collection = DIRECTUS_COLLECTIONS.conversations;
  return directusRequest<DirectusSingleItemResponse<Record<string, unknown>>>(
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export async function getConversation(id: string): Promise<Record<string, unknown> | null> {
  const collection = DIRECTUS_COLLECTIONS.conversations;
  return readDirectusItem<Record<string, unknown>>(
    `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
  );
}

export async function findConversationByVisitorId(
  visitorId: string,
): Promise<Record<string, unknown> | null> {
  const collection = DIRECTUS_COLLECTIONS.conversations;
  const qs = new URLSearchParams();
  qs.set(`filter[${VISITOR_FIELD}][_eq]`, visitorId);
  qs.set("limit", "1");
  const rows = await readDirectusList<Record<string, unknown>>(
    `/items/${encodeURIComponent(collection)}?${qs.toString()}`,
  );
  return rows[0] ?? null;
}

export async function getConversationMessages(conversationId: string) {
  return getMessages(conversationId);
}
