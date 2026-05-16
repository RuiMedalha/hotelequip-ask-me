import { DIRECTUS_COLLECTIONS, directusRequest, readDirectusList } from "@/integrations/directus/client";
import type { DirectusMessagePayload, DirectusSingleItemResponse } from "@/types/directus";

/** Campo FK na collection de mensagens (ajustar se o Hub usar outro nome Directus). */
export const DIRECTUS_MESSAGE_CONVERSATION_FK =
  (import.meta.env.VITE_DIRECTUS_MESSAGE_CONVERSATION_FIELD as string | undefined)?.trim()
  || "conversation_id";

export async function createMessage(
  payload: DirectusMessagePayload,
): Promise<DirectusSingleItemResponse<Record<string, unknown>>> {
  const collection = DIRECTUS_COLLECTIONS.messages;
  return directusRequest<DirectusSingleItemResponse<Record<string, unknown>>>(
    `/items/${encodeURIComponent(collection)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function getMessages(conversationId: string): Promise<Record<string, unknown>[]> {
  const collection = DIRECTUS_COLLECTIONS.messages;
  const qs = new URLSearchParams();
  qs.set(`filter[${DIRECTUS_MESSAGE_CONVERSATION_FK}][_eq]`, conversationId);
  qs.set("sort", "created_at");
  qs.set("limit", "-1");
  return readDirectusList<Record<string, unknown>>(
    `/items/${encodeURIComponent(collection)}?${qs.toString()}`,
  );
}
