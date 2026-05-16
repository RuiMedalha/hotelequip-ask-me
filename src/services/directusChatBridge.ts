import {
  createConversation,
  findConversationByVisitorId,
  getConversation,
  updateConversation,
} from "@/integrations/directus/conversations";
import { createMessage } from "@/integrations/directus/messages";
import { isDirectusConfigured } from "@/integrations/directus/client";
import type { DirectusConversationPayload, DirectusMessagePayload } from "@/types/directus";

function logDirectusDev(...args: unknown[]) {
  if (import.meta.env.DEV) console.info(...args);
}

function requireDirectusConfigured() {
  if (!isDirectusConfigured) {
    throw new Error(
      "Directus não está configurado (defina VITE_DIRECTUS_URL e VITE_DIRECTUS_TOKEN em .env.local).",
    );
  }
}

function coerceId(record: Record<string, unknown>, context: string): string {
  const id = record.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  throw new Error(`${context}: resposta Directus sem id válido.`);
}

function peekCreatedMessageId(record: Record<string, unknown>): string | undefined {
  const id = record?.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return undefined;
}

function parseUnreadCount(conv: Record<string, unknown> | null): number {
  const raw = conv?.unread_count;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) return Math.max(0, n);
  }
  return 0;
}

async function touchConversationAfterUserMessage(conversationId: string, content: string) {
  const trimmed = content.trim();
  const conv = await getConversation(conversationId);
  await updateConversation(conversationId, {
    last_message: trimmed,
    updated_at: new Date().toISOString(),
    unread_count: parseUnreadCount(conv) + 1,
  });
}

async function touchConversationAfterAiMessage(conversationId: string, content: string) {
  const trimmed = content.trim();
  await updateConversation(conversationId, {
    last_message: trimmed,
    updated_at: new Date().toISOString(),
  });
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
    customer_name: "Visitante do site",
    channel: "askme",
    status: "ai_active",
    mode: "bot",
    ai_enabled: true,
    source: "ask_me",
    unread_count: 0,
  };

  const created = await createConversation(payload);
  return coerceId(created.data, "ensureDirectusConversation(create)");
}

export async function saveUserMessage(
  conversationId: string,
  content: string,
): Promise<string | undefined> {
  requireDirectusConfigured();
  const payload: DirectusMessagePayload = {
    conversation_id: conversationId,
    sender_type: "customer",
    sender_name: "Visitante do site",
    content,
  };
  logDirectusDev("[Directus] creating message payload", payload);
  const res = await createMessage(payload);
  logDirectusDev("[Directus] message created", res.data);
  const messageId = peekCreatedMessageId(res.data);
  try {
    await touchConversationAfterUserMessage(conversationId, content);
    logDirectusDev("[Directus] conversation touched after user message");
  }
  catch (e) {
    if (import.meta.env.DEV) console.warn("[Directus] conversation touch after user message failed", e);
  }
  return messageId;
}

export async function saveAiMessage(
  conversationId: string,
  content: string,
): Promise<string | undefined> {
  requireDirectusConfigured();
  const payload: DirectusMessagePayload = {
    conversation_id: conversationId,
    sender_type: "ai",
    sender_name: "Ask Me",
    content,
  };
  logDirectusDev("[Directus] creating message payload", payload);
  const res = await createMessage(payload);
  logDirectusDev("[Directus] message created", res.data);
  const messageId = peekCreatedMessageId(res.data);
  try {
    await touchConversationAfterAiMessage(conversationId, content);
    logDirectusDev("[Directus] conversation touched after ai message");
  }
  catch (e) {
    if (import.meta.env.DEV) console.warn("[Directus] conversation touch after ai message failed", e);
  }
  return messageId;
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
