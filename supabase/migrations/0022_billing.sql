-- ============================================================
-- Contatia — Migration 0022 (Planos + assinatura + billing Asaas)
-- Nível plataforma. Roda depois de 0001-0021. Non-breaking.
-- ============================================================

create table if not exists public.platform_plans (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  price_monthly numeric not null default 0,   -- por assento/mês
  max_seats     int,                          -- null = ilimitado
  sort          int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- assinatura no tenant
alter table public.tenants add column if not exists plan_id uuid references public.platform_plans(id) on delete set null;
alter table public.tenants add column if not exists subscription_status text not null default 'trial'; -- trial|active|past_due|canceled
alter table public.tenants add column if not exists current_period_end date;
alter table public.tenants add column if not exists mrr numeric not null default 0;   -- receita mensal real (assinatura)
alter table public.tenants add column if not exists asaas_customer_id text;
alter table public.tenants add column if not exists asaas_subscription_id text;

-- RLS dos planos: leitura por qualquer autenticado (catálogo); escrita só superadmin
alter table public.platform_plans enable row level security;
create policy platform_plans_read on public.platform_plans for select using (auth.uid() is not null);
create policy platform_plans_write on public.platform_plans for all
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---- Sementes dos planos (valores SUJEITOS A AJUSTE — placeholders do doc) ----
insert into public.platform_plans (name, price_monthly, max_seats, sort)
values
  ('Essencial', 89, 1, 1),
  ('Profissional', 179, 5, 2),
  ('Time', 149, null, 3)
on conflict do nothing;

-- ============================================================
-- WEBHOOK ASAAS (/api/webhooks/asaas, protegido por ASAAS_WEBHOOK_TOKEN):
-- PAYMENT_CONFIRMED/RECEIVED → subscription_status='active', estende current_period_end;
-- PAYMENT_OVERDUE → 'past_due'. Casa por asaas_subscription_id/asaas_customer_id.
-- A RÉGUA lê subscription_status + current_period_end (pendente/vencido) no superadmin.
-- ============================================================
