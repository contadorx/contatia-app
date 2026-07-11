-- ============================================================
-- Contatia — Migration 0049 (Descoberta de e-mail do decisor)
--
-- CONTEXTO: o LinkedIn diz QUEM é o decisor, mas nunca o e-mail dele. E o e-mail
-- do CNPJ (Radar) chega na recepção, não em quem decide. A ponte é descobrir o
-- endereço a partir do NOME + DOMÍNIO — testando os padrões corporativos e
-- CONFIRMANDO no servidor de e-mail se a caixa existe (conversa SMTP que para
-- antes de enviar qualquer coisa).
--
-- REGRA DE OURO: só entra na cadência de e-mail o endereço CONFIRMADO.
-- Não confirmou? O lead vai para a cadência de WhatsApp. Zero chute, zero bounce.
--
-- A verificação roda no worker (VPS), porque o Vercel bloqueia a porta 25.
-- Roda depois das anteriores. Idempotente.
-- ============================================================

-- domínio da empresa: a matéria-prima da descoberta
alter table public.contacts add column if not exists company_domain text;

-- resultado da descoberta:
--   pending    → ainda não tentamos
--   valid      → servidor CONFIRMOU a caixa (pode enviar e-mail)
--   not_found  → testamos todos os padrões, nenhum existe → vai para WhatsApp
--   uncertain  → domínio catch-all (aceita qualquer endereço) → não confiável
--   blocked    → Google/Microsoft não permitem verificar → não dá para saber
--   invalid    → domínio sem servidor de e-mail
alter table public.contacts add column if not exists email_discovery text default 'pending';
alter table public.contacts add column if not exists email_discovered_at timestamptz;

create index if not exists contacts_discovery_idx
  on public.contacts(tenant_id, email_discovery)
  where email is null;

-- ------------------------------------------------------------
-- Fila de descoberta: o app enfileira, o cron processa chamando o worker.
-- Assim a captura do LinkedIn é instantânea (não trava esperando o SMTP,
-- que leva segundos por tentativa).
-- ------------------------------------------------------------
create table if not exists public.email_discovery_queue (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  name         text not null,
  domain       text not null,
  status       text not null default 'pending',   -- pending | done | error
  result       text,                              -- valid | not_found | uncertain | blocked | invalid
  found_email  text,
  attempts     int not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists edq_pending_idx
  on public.email_discovery_queue(status, created_at) where status = 'pending';

create unique index if not exists edq_contact_idx
  on public.email_discovery_queue(contact_id);

alter table public.email_discovery_queue enable row level security;

drop policy if exists edq_all on public.email_discovery_queue;
create policy edq_all on public.email_discovery_queue for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ============================================================
-- FLUXO COMPLETO:
-- 1. Extensão captura o lead do LinkedIn (nome + empresa, sem e-mail).
-- 2. App enfileira a descoberta se souber o domínio da empresa.
-- 3. Cron chama o worker (VPS) → conversa SMTP → confirma a caixa.
-- 4. Confirmou  → grava o e-mail, email_status='ok' → entra na cadência de e-mail.
--    Não achou → email_discovery='not_found' → cadência de WhatsApp.
-- ============================================================
