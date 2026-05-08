-- ============================================================
-- HotelEquip Chatbot — Chatwoot Website Channel relay
-- Corre este ficheiro no SQL Editor do teu Supabase (uma vez)
-- ============================================================

alter table public.conversations
  add column if not exists mode text default 'bot',
  add column if not exists chatwoot_conversation_id bigint,
  add column if not exists chatwoot_contact_id bigint,
  add column if not exists chatwoot_source_id text,
  add column if not exists chatwoot_pubsub_token text,
  add column if not exists chatwoot_last_message_id bigint;

insert into public.bot_settings (key, value) values
  ('chatwoot_website_token', '""'::jsonb)
on conflict (key) do nothing;
