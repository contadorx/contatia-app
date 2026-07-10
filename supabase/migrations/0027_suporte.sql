-- ============================================================
-- Contatia — Migration 0027 (Suporte — tickets)
-- Cliente (dono de workspace) abre chamado; superadmin responde/gerencia.
-- Roda depois de 0001-0026. Non-breaking.
-- ============================================================

create table if not exists public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  opened_by    uuid references public.profiles(id) on delete set null,
  subject      text not null,
  status       text not null default 'open',      -- open | pending | resolved | closed
  priority     text not null default 'normal',    -- low | normal | high
  last_message_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists support_tickets_tenant_idx on public.support_tickets(tenant_id, status);

create table if not exists public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.support_tickets(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  from_staff   boolean not null default false,     -- true = resposta do suporte (superadmin)
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);

-- ---- RLS ----
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

-- Cliente: enxerga/cria tickets do PRÓPRIO tenant. Superadmin: tudo.
create policy support_tickets_tenant on public.support_tickets for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

create policy support_messages_tenant on public.support_messages for all
  using (
    public.is_superadmin() or
    exists (select 1 from public.support_tickets t where t.id = ticket_id and t.tenant_id = public.current_tenant_id())
  )
  with check (
    public.is_superadmin() or
    exists (select 1 from public.support_tickets t where t.id = ticket_id and t.tenant_id = public.current_tenant_id())
  );

-- ============================================================
-- FLUXO: cliente abre ticket em /dashboard/suporte (do seu workspace); troca mensagens.
-- Superadmin gerencia todos em /dashboard/superadmin/suporte (responde, muda status).
-- last_message_at ordena a fila; from_staff distingue resposta do suporte.
-- ============================================================
