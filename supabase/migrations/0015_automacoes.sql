-- ============================================================
-- Contatia — Migration 0015 (Motor de automação — regras GATILHO → AÇÃO)
-- Roda depois de 0001-0014. Non-breaking.
-- ============================================================

create table if not exists public.automations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  trigger_type text not null,   -- doc_opened | link_clicked | replied | score_gte | no_activity_days
  trigger_value text,           -- para score_gte (número) e no_activity_days (dias)
  action_type  text not null,   -- enroll | pause_all | move_stage | mark_hot
  action_seq   uuid references public.sequences(id) on delete set null,   -- para enroll
  action_stage uuid references public.pipeline_stages(id) on delete set null, -- para move_stage
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists automations_tenant_idx on public.automations(tenant_id, trigger_type, is_active);

create table if not exists public.automation_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists automation_logs_tenant_idx on public.automation_logs(tenant_id, created_at desc);

alter table public.automations enable row level security;
alter table public.automation_logs enable row level security;

create policy automations_all on public.automations for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy automation_logs_select on public.automation_logs for select
  using (tenant_id = public.current_tenant_id());

-- ============================================================
-- NOTA: o disparo é feito no código (runAutomations no server), chamado quando
-- um evento é registrado (doc_opened via /s/{token} com service role; replied;
-- score cruzou N) e no cron diário (no_activity_days). O log dá auditoria.
-- ============================================================
