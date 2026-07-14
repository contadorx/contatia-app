-- ============================================================
-- Contatia — Migration 0077 (Caixa de e-mail no quadro de Respostas)
--
-- Até aqui as respostas de E-MAIL eram só DETECTADAS (pausava a cadência), mas o
-- conteúdo era descartado — o quadro de Respostas só mostrava WhatsApp. Esta tabela
-- guarda o corpo das respostas de e-mail (recebidas via IMAP) e os e-mails enviados
-- daqui, para o quadro virar uma CAIXA UNIFICADA (WhatsApp + e-mail).
--
-- Roda depois das anteriores. Idempotente.
-- ============================================================

create table if not exists public.email_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete set null,
  email       text,                                   -- endereço do outro lado
  direction   text not null default 'in',             -- 'in' (recebida) | 'out' (enviada)
  subject     text,
  text        text,
  message_id  text,                                   -- Message-ID do e-mail (dedup)
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists email_messages_tenant_created_idx on public.email_messages(tenant_id, created_at desc);
create index if not exists email_messages_contact_idx        on public.email_messages(tenant_id, contact_id);
-- dedup de mensagens recebidas (o cron pode reprocessar a mesma) por Message-ID.
-- índice SIMPLES (não parcial): NULLs são distintos no Postgres, então mensagens sem
-- Message-ID convivem, e o upsert ON CONFLICT (tenant_id, message_id) consegue inferir.
create unique index if not exists email_messages_msgid_uniq  on public.email_messages(tenant_id, message_id);

alter table public.email_messages enable row level security;
drop policy if exists email_messages_all on public.email_messages;
create policy email_messages_all on public.email_messages for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
