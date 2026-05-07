
# Plano — Chatbot AI com painel de configuração (Supabase próprio)

## Visão geral
Hoje o bot só pesquisa no Meilisearch e devolve texto fixo (sem AI). Vamos transformá-lo num **assistente AI configurável**, ligado à **tua própria instância Supabase** (não Lovable Cloud), com:

1. Painel `/admin` para configurares provedor de AI, modelo, prompts, WooCommerce, Chatwoot e WhatsApp — sem mexer em código.
2. AI a sério com tool-calling (decide quando pesquisar produtos, FAQ, gravar lead ou pedir humano).
3. Captura progressiva de leads.
4. Handoff que envia para WhatsApp **e** abre conversa em Chatwoot self-hosted em simultâneo.

---

## 0. Ligação ao teu Supabase (passo manual teu)

Antes de implementar, vais precisar de:
- Criar/abrir o projecto em [supabase.com](https://supabase.com)
- Copiar `Project URL` e `anon public key` → adicionamos como variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no projecto Lovable
- Copiar a `service_role key` → guardada como secret para as Edge Functions
- Activar **Authentication → Email** no dashboard Supabase

Eu forneço o SQL de migração completo (tabelas + RLS + roles) para correres no SQL Editor do teu Supabase. As Edge Functions ficam no repo em `supabase/functions/` e são deployadas via Supabase CLI (eu deixo as instruções).

---

## 1. Painel de administração `/admin`

Protegido por login (email/password Supabase Auth + role `admin`). Quatro separadores:

**AI Provider**
- Provedor: OpenAI, Anthropic, OpenRouter, Compatível-OpenAI custom
- Base URL editável (ex.: `https://api.openai.com/v1`)
- Modelo (texto livre: `gpt-4o-mini`, `claude-3-5-sonnet`, etc.)
- API Key (guardada como secret no Supabase Vault, mostra só `sk-…últimos4`)
- Temperature, max_tokens
- Botão **Testar ligação**

**Prompts**
- System prompt (textarea grande com default em PT-PT para hotelequip.pt)
- Mensagem boas-vindas
- Mensagem de handoff
- Mensagem fora-de-horário (opcional)

**WooCommerce**
- Store URL (`https://hotelequip.pt`)
- Consumer Key + Secret (secrets)
- Botão Testar (lista 3 produtos)
- Toggle: usar Meilisearch como cache

**Handoff**
- Chatwoot self-hosted: URL, `account_id`, `inbox_id`, `api_access_token`
- WhatsApp: número destino + modo (`wa.me` link ou Twilio)
- Palavras-gatilho ("humano", "agente", "pessoa")

---

## 2. Edge Functions (Supabase)

- **`chat`** — recebe histórico, lê config, chama o provedor configurado, faz streaming SSE com tool-calling
- **`woocommerce-proxy`** — wrapper autenticado WC REST `/wp-json/wc/v3/products`
- **`handoff`** — cria conversa Chatwoot + dispara WhatsApp
- **`test-ai-connection`** / **`test-woocommerce`** — usados pelos botões Testar

Tools expostas ao modelo:
- `search_products(query)` → WooCommerce
- `search_faq(query)` → Meilisearch (mantém integração existente)
- `save_lead(name, email, phone, interest)`
- `request_human_handoff(reason, summary)`

---

## 3. Schema (SQL para correres no teu Supabase)

- `profiles` (id, email)
- `user_roles` (user_id, role: admin/user) — padrão seguro com função `has_role()`
- `bot_settings` (key, value jsonb)
- `bot_secrets` (key, value) — só admin via RLS
- `conversations` (id, visitor_id, status, lead_id, created_at)
- `messages` (id, conversation_id, role, content, created_at)
- `leads` (id, name, email, phone, interest, conversation_id, status, created_at)

RLS em tudo: visitantes só vêem a própria conversa (via `visitor_id` no localStorage); admin vê tudo.

---

## 4. Frontend

- `Chatbot.tsx` reescrito: streaming SSE + render markdown (`react-markdown`)
- `ChatWidget.tsx` mantém-se
- Nova `/admin` com login + 4 separadores
- Nova `/admin/conversations` com histórico e leads

---

## 5. Adaptadores AI

- Base: formato OpenAI Chat Completions (cobre OpenAI, OpenRouter, Groq, Together, Mistral, qualquer compatível)
- Adaptador Anthropic separado (`/v1/messages`, mapeia tools `tool_use`/`tool_result`)
- Sem Lovable AI — `fetch` directo para a URL configurada por ti

---

## 6. Handoff

Quando o modelo chama `request_human_handoff` (ou detecta palavra-gatilho):
1. POST `{chatwoot_url}/api/v1/accounts/{id}/contacts` → cria contacto com nome/email/telefone do lead
2. POST `/conversations` no `inbox_id` configurado → injecta histórico completo como mensagens
3. WhatsApp: link `https://wa.me/351XXXXXXXXX?text=Nova%20lead…` ou Twilio se configurado
4. Marca conversa `status='handoff'`

---

## Ordem de implementação

1. Setup Supabase próprio (variáveis + service_role secret)
2. SQL: tabelas + RLS + roles + função `has_role`
3. Auth + página `/admin/login` + guard de role
4. Painel `/admin` (4 abas) + Edge Functions de teste
5. Edge Function `chat` com adaptadores OpenAI/Anthropic + streaming
6. Tools `search_products` e `search_faq`
7. Captura de leads + listagem
8. Handoff Chatwoot + WhatsApp
9. Refactor `Chatbot.tsx` para streaming + markdown

---

## Notas importantes

- **Tu fazes** o setup do projecto Supabase e correr o SQL de migração. Eu deixo tudo pronto e guiado.
- Deploy de Edge Functions: precisas do **Supabase CLI** instalado localmente (`supabase functions deploy chat`). Alternativamente, posso colar o código pronto para fazeres copy-paste no editor de funções do dashboard Supabase.
- A tua API key de AI fica no Supabase Vault — nunca no código nem no browser.
- Rate-limit por `visitor_id` em todas as Edge Functions para proteger a tua conta de AI.
