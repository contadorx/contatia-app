-- ============================================================
-- Contatia — Migration 0006 (Metas / quota por vendedor)
-- Meta mensal por usuário: receita recorrente (MRR) e atividade (toques).
-- Roda depois de 0001-0005. Non-breaking.
-- ============================================================

create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  period       text not null,                 -- 'YYYY-MM'
  mrr_target   numeric(12,2) not null default 0,
  touch_target int not null default 0,
  created_at   timestamptz not null default now(),
  unique (tenant_id, user_id, period)
);
create index if not exists goals_tenant_idx on public.goals(tenant_id);

alter table public.goals enable row level security;

-- owner gerencia todas as metas do tenant; vendedor vê a própria
create policy goals_select on public.goals for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or user_id = auth.uid())
  );
create policy goals_write on public.goals for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or user_id = auth.uid())
  )
  with check (tenant_id = public.current_tenant_id());
