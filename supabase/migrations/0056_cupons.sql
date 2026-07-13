-- ============================================================
-- Contatia — Migration 0056 (Cupons de desconto com auto-reversão)
--
-- Cupom aplicado no checkout reduz o valor da assinatura por N meses e depois
-- REVERTE sozinho ao preço cheio. A reversão reaproveita o sync de assentos
-- (lib/billing): passada a data, o fator de desconto volta a 1 e o cron reajusta
-- o valor no Asaas — sem job dedicado.
--
-- Nível plataforma. Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.platform_coupons (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  percent_off     int not null,              -- 10 = 10% de desconto
  duration_months int,                       -- null/0 = permanente; N = reverte após N meses
  max_redemptions int,                       -- null = ilimitado
  redeemed_count  int not null default 0,
  is_active       boolean not null default true,
  expires_at      date,                      -- data limite para APLICAR o cupom
  created_at      timestamptz not null default now()
);

alter table public.platform_coupons enable row level security;
drop policy if exists coupons_superadmin on public.platform_coupons;
create policy coupons_superadmin on public.platform_coupons for all
  using (public.is_superadmin()) with check (public.is_superadmin());

-- cupom vigente no tenant (base da auto-reversão)
alter table public.tenants add column if not exists coupon_code text;
alter table public.tenants add column if not exists coupon_percent_off int;
alter table public.tenants add column if not exists coupon_reverts_on date;   -- null = permanente
