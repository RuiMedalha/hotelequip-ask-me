import { createConversation, findConversationByVisitorId, updateConversation } from "@/integrations/directus/conversations";
import { createMessage, DIRECTUS_MESSAGE_CONVERSATION_FK } from "@/integrations/directus/messages";
import { isDirectusConfigured } from "@/integrations/directus/client";
import type { DirectusConversationPayload } from "@/types/directus";

function requireDirectusConfigured() {
  if (!isDirectusConfigured) {
    throw new Error("Directus não está configurado (VITE_DIRECTUS_URL).");
  }
}

function coerceId(record: Record<string, unknown>, context: string): string {
  const id = record.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  throw new Error(`${context}: resposta Directus sem id válido.`);
}

/**
 * Garante uma linha `conversations` no Directus para o visitante (idempotente por `visitor_id`).
 */
export async function ensureDirectusConversation(visitorId: string): Promise<string> {
  requireDirectusConfigured();

  const existing = await findConversationByVisitorId(visitorId);
  if (existing) return coerceId(existing, "ensureDirectusConversation(existing)");

  const payload: DirectusConversationPayload = {
    visitor_id: visitorId,
    status: "open",
    mode: "bot",
    source: "ask_me",
  };

  const created = await createConversation(payload);
  return coerceId(created.data, "ensureDirectusConversation(create)");
}

export async function saveUserMessage(conversationId: string, content: string) {
  requireDirectusConfigured();
  await createMessage({
    [DIRECTUS_MESSAGE_CONVERSATION_FK]: conversationId,
    role: "user",
    content,
  });
}

export async function saveAiMessage(conversationId: string, content: string) {
  requireDirectusConfigured();
  await createMessage({
    [DIRECTUS_MESSAGE_CONVERSATION_FK]: conversationId,
    role: "assistant",
    content,
  });
}

/**
 * Marca a conversa para handoff humano no Directus (o Hub/agente faz o pickup).
 * Não substitui o fluxo atual do Supabase/Chatwoot até a migração.
 */
export async function requestHumanHandoff(
  conversationId: string,
  reason?: string,
  summary?: string,
  channel?: string,
) {
  requireDirectusConfigured();

  const payload: DirectusConversationPayload = {
    status: "handoff",
    mode: "human",
    handoff_reason: reason,
    handoff_summary: summary,
    channel,
  };

  await updateConversation(conversationId, payload);
}
