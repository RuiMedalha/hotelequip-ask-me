/** Estados de conversa alinhados com Communication Hub. */
export const CONVERSATION_STATUS = {
  AI_ACTIVE: "ai_active",
  HUMAN_ACTIVE: "human_active",
  CLOSED: "closed",
} as const;

export const DIRECTUS_REOPEN_SYSTEM_MESSAGE =
  "Cliente voltou a contactar. Conversa reaberta automaticamente.";

export function readConversationStatus(conv: Record<string, unknown> | null): string {
  return typeof conv?.status === "string" ? conv.status.toLowerCase().trim() : "";
}

export function isConversationClosed(conv: Record<string, unknown> | null): boolean {
  const status = readConversationStatus(conv);
  return status === CONVERSATION_STATUS.CLOSED || status === "resolved";
}

/** Conversa reutilizável (não fechada). */
export function isConversationActive(conv: Record<string, unknown> | null): boolean {
  if (!conv) return false;
  return !isConversationClosed(conv);
}
