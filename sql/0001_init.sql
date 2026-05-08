-- ============================================================
-- HotelEquip Chatbot — Initial schema
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

do $$ begin
  create type public.app_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create table if not exists public.bot_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.bot_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  status text not null default 'active',
  lead_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete set null,
  name text, email text, phone text, interest text,
  status text default 'new',
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.bot_settings enable row level security;
alter table public.bot_secrets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.leads enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles for select to authenticated using (auth.uid() = id);

drop policy if exists "roles self read" on public.user_roles;
create policy "roles self read" on public.user_roles for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
drop policy if exists "roles admin write" on public.user_roles;
create policy "roles admin write" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

drop policy if exists "settings admin all" on public.bot_settings;
create policy "settings admin all" on public.bot_settings for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

drop policy if exists "secrets admin all" on public.bot_secrets;
create policy "secrets admin all" on public.bot_secrets for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

drop policy if exists "conv admin read" on public.conversations;
create policy "conv admin read" on public.conversations for select to authenticated using (public.has_role(auth.uid(),'admin'));
drop policy if exists "msg admin read" on public.messages;
create policy "msg admin read" on public.messages for select to authenticated using (public.has_role(auth.uid(),'admin'));
drop policy if exists "leads admin all" on public.leads;
create policy "leads admin all" on public.leads for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

insert into public.bot_settings (key, value) values
  ('ai_provider', '"openai"'::jsonb),
  ('ai_base_url', '"https://api.openai.com/v1"'::jsonb),
  ('ai_model', '"gpt-4o-mini"'::jsonb),
  ('ai_temperature', '0.7'::jsonb),
  ('ai_max_tokens', '1024'::jsonb),
  ('system_prompt', '"És o assistente virtual da HotelEquip (hotelequip.pt), especialista em equipamentos para hotéis e restaurantes. Responde sempre em português de Portugal, simpático e profissional.\n\nREGRA #1 — Na PRIMEIRA mensagem da conversa, antes de qualquer outra coisa, pergunta o nome do cliente (\"Antes de mais, como te chamas?\"). Só depois respondes ao pedido. Quando souberes o nome, chama save_lead imediatamente. Mais tarde recolhe email e telefone progressivamente.\n\nREGRA #2 — Quando search_products devolver resultados, formata SEMPRE cada produto como um cartão em markdown:\n\n### [Nome do produto](permalink)\n![](url_da_imagem)\n**Preço:** X €  \nDescrição curta.\n\nUsa o link real (permalink) e a imagem real (campo image) devolvidos pela ferramenta. Nunca inventes URLs.\n\nUsa request_human_handoff se pedirem humano."'::jsonb),
  ('welcome_message', '"Olá! 👋 Sou o assistente da HotelEquip. Antes de mais, como te chamas?"'::jsonb),
  ('handoff_message', '"Vou passar a sua conversa para um colega da equipa. Em breve será contactado."'::jsonb),
  ('handoff_keywords', '["humano","agente","pessoa","atendente","vendedor"]'::jsonb),
  ('woo_store_url', '"https://hotelequip.pt"'::jsonb),
  ('use_meilisearch_cache', 'true'::jsonb),
  ('chatwoot_url', '""'::jsonb),
  ('chatwoot_account_id', '""'::jsonb),
  ('chatwoot_inbox_id', '""'::jsonb),
  ('whatsapp_number', '""'::jsonb),
  ('whatsapp_mode', '"link"'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- Depois: cria utilizador em Auth → Users e corre:
--   insert into public.user_roles(user_id, role)
--   values ('<uid>', 'admin');
-- ============================================================
