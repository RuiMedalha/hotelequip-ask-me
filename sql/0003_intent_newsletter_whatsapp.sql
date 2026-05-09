-- ============================================================
-- HotelEquip Chatbot — Intent menu, Newsletter/GDPR, WhatsApp settings
-- Run in Supabase SQL Editor (self-hosted)
-- ============================================================

-- 1) Intenção inicial + canal escolhido para handoff
alter table public.conversations
  add column if not exists intent  text,
  add column if not exists channel text;  -- 'chat' | 'whatsapp'

-- 2) Newsletter / GDPR no lead
alter table public.leads
  add column if not exists newsletter_opt_in   boolean     not null default false,
  add column if not exists gdpr_consent        boolean     not null default false,
  add column if not exists gdpr_consent_at     timestamptz;

-- 3) Configuração WhatsApp (Meta Cloud API) e novos defaults
insert into public.bot_settings (key, value) values
  ('meta_wa_phone_number_id', '""'::jsonb),
  ('meta_wa_template',        '""'::jsonb),
  ('meta_wa_template_lang',   '"pt_PT"'::jsonb),
  ('intent_menu', '[
    {"value":"produtos","label":"🛒 Ver produtos"},
    {"value":"orcamento","label":"💬 Pedir orçamento"},
    {"value":"duvida","label":"❓ Tirar uma dúvida"},
    {"value":"humano","label":"👤 Falar com a equipa"}
  ]'::jsonb),
  ('newsletter_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- Notas:
--   - meta_wa_phone_number_id e meta_wa_template guardam-se em bot_settings
--     (não-secreto). O TOKEN da Meta deve ficar em bot_secrets como
--     "meta_wa_token" (gere via painel Admin → Secrets).
-- ============================================================
