/**
 * Campos aceites pelo Directus ao criar/atualizar conversas (Ask Me → Hub).
 * Ajustar às collections reais quando o schema do Directus estiver fechado.
 */
export interface DirectusConversationPayload {
  visitor_id?: string;
  status?: string;
  mode?: string;
  channel?: string;
  summary?: string;
  /** Motivo relatado pelo cliente / ferramentas (equivalente ao handoff Supabase). */
  handoff_reason?: string;
  /** Resumo para o agente (equivalente ao handoff Supabase). */
  handoff_summary?: string;
  /** Origem lógica no ecossistema (ex.: widget). */
  source?: string;
  /** Extensível para campos do Hub sem quebrar o tipo. */
  [key: string]: unknown;
}

/**
 * Mensagem gravada no Directus (persistência paralela ao Supabase até migração completa).
 */
export interface DirectusMessagePayload {
  /** UUID da conversa no Directus (nome da coluna pode variar: usar alias no schema). */
  conversation_id?: string;
  /** Alguns schemas usam FK com o nome da relação Directus em vez de `conversation_id`. */
  conversation?: string;
  role?: "user" | "assistant" | "agent" | string;
  content?: string;
  [key: string]: unknown;
}

export type DirectusSingleItemResponse<T> = { data: T };

export type DirectusListResponse<T> = { data: T[] };
