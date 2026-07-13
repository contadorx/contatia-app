-- ============================================================
-- Contatia — Migration 0054 (Respostas: guardar o que o lead responde)
--
-- ANTES: o webhook do WhatsApp marcava "respondeu" e JOGAVA O TEXTO FORA. O
-- vendedor sabia QUE responderam, nunca O QUE responderam — tinha que ir ao
-- aparelho ler. Agora toda mensagem (entrada e saída) fica guardada e vira uma
-- caixa de Respostas dentro do app.
--
-- Também passamos a registrar o ESTADO da conexão da instância (evento
-- CONNECTION_UPDATE), para avisar quando o número desconecta em vez de falhar
-- os envios em silêncio.
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.whatsapp_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  account_id    uuid references public.whatsapp_accounts(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  phone         text,
  direction     text not null default 'in',   -- 'in' (recebida) | 'out' (enviada)
  text          text,
  wa_message_id text,
  raw           jsonb not null default '{}'::jsonb,
  read_at       timestamptz,                   -- null = não lida (só faz sentido para 'in')
  created_at    timestamptz not null default now()
);

create index if not exists wamsg_tenant_created_idx on public.whatsapp_messages(tenant_id, created_at desc);
create index if not exists wamsg_contact_idx on public.whatsapp_messages(contact_id);
create index if not exists wamsg_unread_idx on public.whatsapp_messages(tenant_id)
  where direction = 'in' and read_at is null;
-- dedupe: a Evolution pode reenviar o mesmo webhook
create unique index if not exists wamsg_waid_idx on public.whatsapp_messages(tenant_id, wa_message_id)
  where wa_message_id is not null;

alter table public.whatsapp_messages enable row level security;
drop policy if exists wamsg_all on public.whatsapp_messages;
create policy wamsg_all on public.whatsapp_messages for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- estado da conexão da instância (do CONNECTION_UPDATE do webhook)
alter table public.whatsapp_accounts add column if not exists status text;
alter table public.whatsapp_accounts add column if not exists last_seen_at timestamptz;
