# HotelEquip Ask Me — Cursor Rules + CLAUDE.md
# URL produção: em staging (a publicar)
# Widget embed: public/widget.js

## O QUE É ESTE PROJECTO
Widget de IA conversacional para o site hotelequip.pt.
Responde a perguntas sobre produtos HORECA, faz handoff para operador humano,
captura leads (email/telefone), e suporta newsletter opt-in.
Usa Supabase Edge Functions como backend de IA (Claude/OpenAI).
Guarda conversas tanto em Supabase como em Directus (bridge dual).

## STACK
- React 18 + TypeScript + Vite + Tailwind + shadcn/ui
- Backend IA: Supabase Edge Functions (Deno)
  - chat/index.ts → resposta IA (Claude/OpenAI + RAG)
  - handoff/index.ts → criar conversa no hub quando handoff
  - ingest-knowledge/index.ts → ingerir docs na base de conhecimento
  - transcribe-audio/index.ts → transcrição de áudio
- Bridge dual: Supabase (IA) + Directus (histórico no hub)
- Widget embebível: public/widget.js (vai para o site WordPress)

## REGRAS ABSOLUTAS
1. NUNCA remover a integração Supabase — é o backend de IA
2. NUNCA remover a integração Directus — é o bridge para o hub
3. NUNCA alterar widget.js sem testar no site primeiro
4. NUNCA mudar a lógica de handoff sem validar com o hub
5. SEMPRE fazer alterações cirúrgicas
6. SEMPRE TypeScript strict

## ARQUITECTURA
```
Widget (public/widget.js) embebido no site WordPress
  → abre iframe/popup com a app React
  
App React:
  Index.tsx → página principal com Chatbot embebido
  Chatbot.tsx → componente central (estado, mensagens, handoff)
    → supabase Edge Function /chat → resposta IA
    → directusChatBridge.ts → guardar msgs no Directus
    → quando handoff → supabase /handoff → cria conversa no Hub
  Admin.tsx → painel admin (conversas, webhooks, settings)
```

## FICHEIROS CRÍTICOS
- src/components/Chatbot.tsx → componente principal — CUIDADO ao editar
- src/services/directusChatBridge.ts → bridge Supabase↔Directus
- src/integrations/supabase/client.ts → cliente Supabase + FUNCTIONS_URL
- src/integrations/directus/client.ts → cliente Directus
- public/widget.js → script embebível no WordPress

## VARIÁVEIS DE AMBIENTE
```
VITE_SUPABASE_URL=[URL Supabase do projecto Ask Me]
VITE_SUPABASE_ANON_KEY=[anon key]
VITE_DIRECTUS_URL=https://api.hotelequip.pt
VITE_DIRECTUS_TOKEN=0TuAkkyjdFp8BZlKmOjc443mbQba0smF
```

## FUNCIONALIDADES IMPLEMENTADAS
- Chat IA com RAG (base de conhecimento de produtos HORECA) ✅
- Handoff humano → cria conversa no Hub Directus ✅
- Captura de email/telefone do utilizador ✅
- Newsletter opt-in ✅
- Suporte a media (imagens, áudio) ✅
- Widget embebível WordPress ✅
- Painel admin (conversas, webhooks) ✅

## INTEGRAÇÃO COM HUB E CRM
- Handoff: quando utilizador pede humano → cria conversation no Directus
  → aparece no Hub (hubchat.hotelequip.pt) como conversa nova
- Histórico: mensagens guardadas em Directus via directusChatBridge
- CRM URL: https://crm.hotelequip.pt (operador abre ficha do cliente)

## TRABALHO EM CURSO
1. Melhorar base de conhecimento (ingest mais produtos do WooCommerce)
2. Integrar com Directus como fonte primária (reduzir dependência Supabase)
3. Publicar em produção no site hotelequip.pt

## IDIOMA E TOM
- Português PT-PT
- Tom: prestável, profissional, directo
- Nome do assistente: "Ask Me" (não "bot", não "assistente")
- Handoff: "Vou ligar-te a um especialista HotelEquip"
