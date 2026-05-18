import {
  createConversation,
  findLatestConversationByVisitorId,
  getConversation,
  updateConversation,
} from "@/integrations/directus/conversations";
import { createMessage } from "@/integrations/directus/messages";
import { isDirectusConfigured } from "@/integrations/directus/client";
import {
  CONVERSATION_STATUS,
  isConversationActive,
  isConversationClosed,
} from "@/lib/directusConversationLifecycle";
import { lastMessageLabelForMedia } from "@/lib/fileMedia";
import type { MediaContentType, MessageAttachment } from "@/types/media";
import type { DirectusConversationPayload, DirectusMessagePayload } from "@/types/directus";

export type EnsureDirectusConversationResult = {
  conversationId: string;
  /** true quando uma conversa fechada foi reaberta para este visitante. */
  reopened: boolean;
};

export { CONVERSATION_STATUS } from "@/lib/directusConversationLifecycle";
export { DIRECTUS_REOPEN_SYSTEM_MESSAGE } from "@/lib/directusConversationLifecycle";

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

async function touchConversationAfterUserMessage(
  conversationId: string,
  content: string,
  contentType: MediaContentType = "text",
) {
  const label = lastMessageLabelForMedia(contentType, content);
  const conv = await getConversation(conversationId);
  await updateConversation(conversationId, {
    last_message: label,
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

async function createNewDirectusConversation(visitorId: string): Promise<string> {
  const payload: DirectusConversationPayload = {
    visitor_id: visitorId,
    customer_name: "Visitante do site",
    channel: "askme",
    status: CONVERSATION_STATUS.AI_ACTIVE,
    mode: "bot",
    ai_enabled: true,
    source: "ask_me",
    unread_count: 0,
  };
  const created = await createConversation(payload);
  return coerceId(created.data, "createNewDirectusConversation");
}

/**
 * Reabre conversa fechada mantendo visitor_id, contact_id e customer_name.
 */
export async function reopenClosedDirectusConversation(conversationId: string) {
  requireDirectusConfigured();
  const conv = await getConversation(conversationId);
  const priorUnread = parseUnreadCount(conv);
  await updateConversation(conversationId, {
    status: CONVERSATION_STATUS.AI_ACTIVE,
    mode: "bot",
    ai_enabled: true,
    unread_count: priorUnread > 0 ? priorUnread + 1 : 1,
    updated_at: new Date().toISOString(),
  });
  logDirectusDev("[Directus] conversation reopened", conversationId);
}

/**
 * Garante conversa Directus para o visitante: reutiliza activa ou reabre fechada; senão cria nova.
 */
export async function ensureDirectusConversationWithMeta(
  visitorId: string,
): Promise<EnsureDirectusConversationResult> {
  requireDirectusConfigured();

  const existing = await findLatestConversationByVisitorId(visitorId);
  if (existing) {
    const id = coerceId(existing, "ensureDirectusConversation(existing)");
    if (isConversationClosed(existing)) {
      await reopenClosedDirectusConversation(id);
      return { conversationId: id, reopened: true };
    }
    if (isConversationActive(existing)) {
      return { conversationId: id, reopened: false };
    }
    await reopenClosedDirectusConversation(id);
    return { conversationId: id, reopened: true };
  }

  const id = await createNewDirectusConversation(visitorId);
  return { conversationId: id, reopened: false };
}

/** @inheritdoc ensureDirectusConversationWithMeta */
export async function ensureDirectusConversation(visitorId: string): Promise<string> {
  const { conversationId } = await ensureDirectusConversationWithMeta(visitorId);
  return conversationId;
}

/** Hub: encerrar conversa. */
export async function closeDirectusConversation(conversationId: string) {
  requireDirectusConfigured();
  await updateConversation(conversationId, {
    status: CONVERSATION_STATUS.CLOSED,
    ai_enabled: false,
    unread_count: 0,
    updated_at: new Date().toISOString(),
  });
  logDirectusDev("[Directus] conversation closed", conversationId);
}

/** Hub: reabrir conversa (atalho). */
export async function reopenDirectusConversation(conversationId: string) {
  await reopenClosedDirectusConversation(conversationId);
}

/** Hub: reativar IA na conversa. */
export async function reactivateAiOnDirectusConversation(conversationId: string) {
  requireDirectusConfigured();
  await updateConversation(conversationId, {
    status: CONVERSATION_STATUS.AI_ACTIVE,
    mode: "bot",
    ai_enabled: true,
    assigned_to: null,
    updated_at: new Date().toISOString(),
  });
  logDirectusDev("[Directus] AI reactivated on conversation", conversationId);
}

/** Hub: operador assume a conversa. */
export async function assumeDirectusConversation(conversationId: string, assignedTo?: string) {
  requireDirectusConfigured();
  const patch: DirectusConversationPayload = {
    status: CONVERSATION_STATUS.HUMAN_ACTIVE,
    mode: "human",
    ai_enabled: false,
    updated_at: new Date().toISOString(),
  };
  if (assignedTo?.trim()) patch.assigned_to = assignedTo.trim();
  await updateConversation(conversationId, patch);
  logDirectusDev("[Directus] conversation assumed", conversationId, assignedTo);
}

export async function updateDirectusConversation(
  conversationId: string,
  patch: DirectusConversationPayload,
) {
  requireDirectusConfigured();
  await updateConversation(conversationId, patch);
}

export {
  applyNewsletterOptIn,
  captureCustomerIdentity,
  createContactFromAskMe,
  findContactByEmail,
  findContactByPhone,
  linkConversationToContact,
  syncCustomerDetailsFromUserMessage,
  updateContactFromAskMe,
} from "@/services/directusCustomerIdentity";

export async function saveUserMessage(
  conversationId: string,
  content: string,
): Promise<string | undefined> {
  return saveUserMediaMessage(conversationId, {
    content,
    content_type: "text",
    attachments: [],
  });
}

export async function saveUserMediaMessage(
  conversationId: string,
  options: {
    content?: string;
    content_type: MediaContentType;
    attachments: MessageAttachment[];
  },
): Promise<string | undefined> {
  requireDirectusConfigured();
  const content = options.content?.trim() ?? "";
  const payload: DirectusMessagePayload = {
    conversation_id: conversationId,
    sender_type: "customer",
    sender_name: "Visitante do site",
    content: content || lastMessageLabelForMedia(options.content_type),
    content_type: options.content_type,
    attachments: options.attachments,
  };
  logDirectusDev("[Directus] creating message payload", {
    ...payload,
    attachments: options.attachments.map((a) => ({
      ...a,
      base64: a.base64 ? `[${a.base64.length} chars]` : null,
    })),
  });
  const res = await createMessage(payload);
  logDirectusDev("[Directus] message created", res.data);
  const messageId = peekCreatedMessageId(res.data);
  try {
    await touchConversationAfterUserMessage(conversationId, content, options.content_type);
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
    status: CONVERSATION_STATUS.HUMAN_ACTIVE,
    mode: "human",
    ai_enabled: false,
    handoff_reason: reason,
    handoff_summary: summary,
    channel,
    updated_at: new Date().toISOString(),
  };

  await updateConversation(conversationId, payload);
}
