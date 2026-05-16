/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DIRECTUS_URL?: string;
  readonly VITE_DIRECTUS_TOKEN?: string;
  /** Slug Directus da collection de conversas (default: conversations). */
  readonly VITE_DIRECTUS_CONVERSATIONS_COLLECTION?: string;
  /** Slug Directus da collection de mensagens (default: messages). */
  readonly VITE_DIRECTUS_MESSAGES_COLLECTION?: string;
  /** Nome da coluna FK mensagem→conversa (default: conversation_id). */
  readonly VITE_DIRECTUS_MESSAGE_CONVERSATION_FIELD?: string;
  /** Campo onde o widget grava o id anónimo do visitante (default: visitor_id). */
  readonly VITE_DIRECTUS_CONVERSATION_VISITOR_FIELD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
