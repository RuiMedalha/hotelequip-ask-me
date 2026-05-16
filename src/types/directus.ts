/**
 * Campos aceites pelo Directus ao criar/atualizar conversas (Ask Me → Hub).
 * Ajustar às collections reais quando o schema do Directus estiver fechado.
 */
export interface DirectusConversationPayload {
  visitor_id?: string;
  customer_name?: string;
  status?: string;
  mode?: string;
  channel?: string;
  ai_enabled?: boolean;
  unread_count?: number;
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
  conversation_id?: string;
  sender_type?: string;
  sender_name?: string;
  content?: string;
  /** Legado / extensível */
  conversation?: string;
  role?: string;
  [key: string]: unknown;
}

export type DirectusSingleItemResponse<T> = { data: T };

export type DirectusListResponse<T> = { data: T[] };
