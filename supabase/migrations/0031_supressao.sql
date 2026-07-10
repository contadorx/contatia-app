-- ============================================================
-- Contatia — Migration 0031 (Supressão de bounces / proteção de reputação)
-- Cadência que insiste em e-mail que devolveu queima o domínio. Esta migração cria a
-- lista de supressão e o status do e-mail no contato. Roda depois de 0001-0030.
-- ============================================================

-- status do e-mail no contato: ok | hard_bounce | soft_bounce | complaint | invalid
alter table public.contacts add column if not exists email_status text default 'ok';

-- lista de supressão por workspace (e-mails que NÃO devem mais receber)
create table if not exists public.email_suppressions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  reason      text not null default 'bounce',   -- hard_bounce | complaint | unsubscribe | manual | invalid
  created_at  timestamptz not null default now(),
  unique (tenant_id, email)
);
create index if not exists email_suppressions_tenant_idx on public.email_suppressions(tenant_id, email);

alter table public.email_suppressions enable row level security;
create policy email_suppressions_tenant on public.email_suppressions for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- ============================================================
-- FLUXO: webhook do Brevo recebe hard bounce / spam complaint / unsubscribe →
-- adiciona o e-mail à supressão + marca contacts.email_status. Antes de cada envio de
-- e-mail, a Contatia checa a supressão e PULA (não queima o domínio). Cadências de e-mail
-- do contato suprimido são pausadas.
-- ============================================================
